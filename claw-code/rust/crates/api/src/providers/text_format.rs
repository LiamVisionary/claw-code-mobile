//! Demuxes model-emitted tool calls that arrive embedded in the text channel
//! of an OpenAI-compatible `content` stream instead of the structured
//! `tool_calls` array.
//!
//! Some local runners (Ollama, llama.cpp) happily pass the `tools=[...]`
//! request parameter through to models that were trained on their own native
//! tool-call encoding (Harmony for gpt-oss, Hermes/Qwen-XML for Qwen-Coder
//! and Nous-Hermes family). The model then writes its tool calls into the
//! regular assistant-text stream using that encoding, and the structured
//! `tool_calls` field arrives empty.
//!
//! This module detects the format from the model name and runs a streaming
//! state machine over each text chunk, yielding clean text, thinking, and
//! synthetic tool-call deltas — so the rest of the pipeline sees the same
//! events it would have gotten from a well-behaved OpenAI tool-call stream.

/// Which on-the-wire text format a given model uses for tool calls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TextFormat {
    /// Either no tool-call markup in text (structured `tool_calls` field is
    /// authoritative) or the format is unknown — pass text through unchanged.
    #[default]
    Default,
    /// OpenAI gpt-oss Harmony channels: `<|channel|>…<|message|>…<|end|>`.
    Harmony,
    /// Hermes / Qwen XML: `<tool_call>{...}</tool_call>` (and the
    /// `<function=name>{...}</function>` variant some Qwen tunes emit).
    HermesXml,
}

impl TextFormat {
    /// Sniff the format from a model identifier. Matches on the bare model
    /// name with any routing prefix (`openai/`, `ollama/`, etc.) stripped.
    #[must_use]
    pub fn detect_from_model(model: &str) -> Self {
        let lowered = model.to_ascii_lowercase();
        let canonical = lowered.rsplit('/').next().unwrap_or(lowered.as_str());

        if canonical.starts_with("gpt-oss") || canonical.contains("gpt-oss") {
            return Self::Harmony;
        }
        if canonical.starts_with("qwen") && canonical.contains("coder") {
            return Self::HermesXml;
        }
        if canonical.contains("hermes") || canonical.starts_with("nous-") {
            return Self::HermesXml;
        }
        if canonical.starts_with("qwen2.5") || canonical.starts_with("qwen3") {
            // Qwen2.5-Instruct and Qwen3 family were trained on Hermes-style
            // XML tool calls.
            return Self::HermesXml;
        }

        Self::Default
    }
}

/// One unit of output emitted by the demuxer during streaming.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DemuxEvent {
    /// Clean assistant text, with any tool-call markup already stripped.
    Text(String),
    /// Thinking / analysis content (Harmony's `analysis` channel).
    Thinking(String),
    /// A complete tool call, assembled once its closing token was seen.
    /// `arguments` is the raw JSON string as emitted by the model.
    ToolCall {
        name: String,
        arguments: String,
    },
}

/// Streaming state machine that consumes text-delta bytes in arbitrary
/// chunks and emits a cleaned-up sequence of text / thinking / tool calls.
///
/// Handling partial tokens across chunk boundaries is the whole point of
/// this struct — callers push raw chunks as they arrive from the SSE parser,
/// and the demuxer buffers anything that *might* be the start of a marker
/// until it can decide.
#[derive(Debug)]
pub struct FormatDemuxer {
    format: TextFormat,
    state: DemuxState,
    /// Bytes that might be a partial marker we haven't committed yet.
    buffer: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DemuxState {
    /// Outside any special region — bytes are plain text.
    Text,
    /// Inside a Harmony channel of the given kind, reading the message body.
    HarmonyChannelBody(HarmonyChannel),
    /// Inside `<tool_call>...</tool_call>` (Hermes).
    HermesToolCall,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum HarmonyChannel {
    /// analysis: thinking / scratchpad. Maps to thinking deltas.
    Analysis,
    /// final: user-facing response. Maps to text deltas.
    Final,
    /// commentary to=functions.NAME: tool call. Message body is JSON args.
    Commentary { tool_name: String },
    /// Any other channel we don't know about — treat the body as text so we
    /// don't swallow user-visible output if the model invents a new channel.
    Unknown,
}

impl FormatDemuxer {
    #[must_use]
    pub const fn new(format: TextFormat) -> Self {
        Self {
            format,
            state: DemuxState::Text,
            buffer: String::new(),
        }
    }

    /// Push one delta's worth of text. Returns any demux events that could be
    /// finalized from the combined buffered + newly-pushed content.
    pub fn push(&mut self, chunk: &str) -> Vec<DemuxEvent> {
        if matches!(self.format, TextFormat::Default) {
            // Fast path: no demuxing needed.
            if chunk.is_empty() {
                return Vec::new();
            }
            return vec![DemuxEvent::Text(chunk.to_string())];
        }

        self.buffer.push_str(chunk);
        let mut out = Vec::new();
        loop {
            let before = self.buffer.len();
            match self.format {
                TextFormat::Harmony => self.step_harmony(&mut out),
                TextFormat::HermesXml => self.step_hermes(&mut out),
                TextFormat::Default => unreachable!(),
            }
            // Stop when no progress was made on this iteration — we need
            // more input to decide on the current partial buffer.
            if self.buffer.len() == before {
                break;
            }
        }
        out
    }

    /// Signal end-of-stream. Flushes any trailing buffered content as text
    /// (or thinking, if we were inside an analysis channel) so nothing is
    /// lost if the model forgot its closing token.
    pub fn finish(&mut self) -> Vec<DemuxEvent> {
        if self.buffer.is_empty() {
            return Vec::new();
        }
        let tail = std::mem::take(&mut self.buffer);
        match self.state {
            DemuxState::Text => vec![DemuxEvent::Text(tail)],
            DemuxState::HarmonyChannelBody(HarmonyChannel::Analysis) => {
                vec![DemuxEvent::Thinking(tail)]
            }
            DemuxState::HarmonyChannelBody(HarmonyChannel::Final | HarmonyChannel::Unknown) => {
                vec![DemuxEvent::Text(tail)]
            }
            DemuxState::HarmonyChannelBody(HarmonyChannel::Commentary { ref tool_name }) => {
                // Tool call never closed — still try to surface it so the
                // loop sees *something* instead of silently losing the call.
                vec![DemuxEvent::ToolCall {
                    name: tool_name.clone(),
                    arguments: tail,
                }]
            }
            DemuxState::HermesToolCall => {
                // Malformed — closing tag missing. Fall back to emitting the
                // raw buffered body as text so the user at least sees it.
                vec![DemuxEvent::Text(format!("<tool_call>{tail}"))]
            }
        }
    }

    // ---- Harmony ----

    fn step_harmony(&mut self, out: &mut Vec<DemuxEvent>) {
        match self.state.clone() {
            DemuxState::Text => {
                // Look for the next channel opener: `<|channel|>`.
                if let Some(pos) = self.buffer.find("<|channel|>") {
                    if pos > 0 {
                        let preamble: String = self.buffer.drain(..pos).collect();
                        emit_harmony_outside_text(&preamble, out);
                    }
                    // Consume the opener.
                    self.buffer.drain(.."<|channel|>".len());
                    // Parse channel header: `NAME[ to=TARGET]<|message|>`.
                    if let Some(header_end) = self.buffer.find("<|message|>") {
                        let header: String = self.buffer.drain(..header_end).collect();
                        self.buffer.drain(.."<|message|>".len());
                        self.state =
                            DemuxState::HarmonyChannelBody(parse_harmony_header(header.trim()));
                    }
                    // else: header not yet complete, wait for more bytes.
                } else if let Some(safe_up_to) = safe_emit_boundary(&self.buffer, "<|channel|>") {
                    if safe_up_to > 0 {
                        let safe: String = self.buffer.drain(..safe_up_to).collect();
                        emit_harmony_outside_text(&safe, out);
                    }
                }
            }
            DemuxState::HarmonyChannelBody(channel) => {
                // Message ends at `<|end|>`, `<|call|>` (tool call complete),
                // or the start of the next `<|start|>` / `<|channel|>` frame.
                let close_tokens = ["<|end|>", "<|call|>", "<|return|>"];
                let mut close_pos: Option<(usize, usize)> = None;
                for tok in close_tokens {
                    if let Some(p) = self.buffer.find(tok) {
                        if close_pos.is_none_or(|(cur, _)| p < cur) {
                            close_pos = Some((p, tok.len()));
                        }
                    }
                }
                // Also terminate early if the next frame starts before a close.
                let next_frame_pos = ["<|start|>", "<|channel|>"]
                    .iter()
                    .filter_map(|t| self.buffer.find(t))
                    .min();
                let terminator = match (close_pos, next_frame_pos) {
                    (Some((cp, cl)), Some(np)) if cp <= np => Some((cp, cl)),
                    (Some(cp), None) => Some(cp),
                    (None, Some(np)) => Some((np, 0)),
                    (Some((_cp, _cl)), Some(np)) => Some((np, 0)),
                    (None, None) => None,
                };
                if let Some((pos, consume)) = terminator {
                    let body: String = self.buffer.drain(..pos).collect();
                    self.buffer.drain(..consume);
                    emit_harmony_channel_body(&channel, body, out);
                    self.state = DemuxState::Text;
                } else if let Some(safe_up_to) =
                    safe_emit_boundary_multi(&self.buffer, &["<|end|>", "<|call|>", "<|return|>", "<|start|>", "<|channel|>"])
                {
                    if safe_up_to > 0 {
                        let safe: String = self.buffer.drain(..safe_up_to).collect();
                        emit_harmony_channel_body(&channel, safe, out);
                    }
                }
            }
            DemuxState::HermesToolCall => unreachable!("hermes state during harmony step"),
        }
    }

    // ---- Hermes XML ----

    fn step_hermes(&mut self, out: &mut Vec<DemuxEvent>) {
        match self.state {
            DemuxState::Text => {
                if let Some(pos) = self.buffer.find("<tool_call>") {
                    if pos > 0 {
                        let text: String = self.buffer.drain(..pos).collect();
                        out.push(DemuxEvent::Text(text));
                    }
                    self.buffer.drain(.."<tool_call>".len());
                    self.state = DemuxState::HermesToolCall;
                } else if let Some(safe_up_to) = safe_emit_boundary(&self.buffer, "<tool_call>") {
                    if safe_up_to > 0 {
                        let text: String = self.buffer.drain(..safe_up_to).collect();
                        out.push(DemuxEvent::Text(text));
                    }
                }
            }
            DemuxState::HermesToolCall => {
                if let Some(pos) = self.buffer.find("</tool_call>") {
                    let body: String = self.buffer.drain(..pos).collect();
                    self.buffer.drain(.."</tool_call>".len());
                    if let Some(call) = parse_hermes_tool_call(body.trim()) {
                        out.push(call);
                    }
                    self.state = DemuxState::Text;
                }
                // else: wait for the closing tag.
            }
            DemuxState::HarmonyChannelBody(_) => {
                unreachable!("harmony state during hermes step")
            }
        }
    }
}

fn emit_harmony_outside_text(preamble: &str, out: &mut Vec<DemuxEvent>) {
    // Between channels we often see `<|start|>assistant` / `<|end|>` frame
    // scaffolding with no user content. Strip known framing tokens so they
    // don't leak into the chat bubble. Anything else is kept as text.
    let cleaned = preamble
        .replace("<|start|>assistant", "")
        .replace("<|start|>", "")
        .replace("<|end|>", "")
        .replace("<|call|>", "")
        .replace("<|return|>", "")
        .replace("<|message|>", "");
    let trimmed = cleaned.trim_matches('\n');
    if !trimmed.is_empty() {
        out.push(DemuxEvent::Text(trimmed.to_string()));
    }
}

fn emit_harmony_channel_body(
    channel: &HarmonyChannel,
    body: String,
    out: &mut Vec<DemuxEvent>,
) {
    match channel {
        HarmonyChannel::Analysis => {
            if !body.is_empty() {
                out.push(DemuxEvent::Thinking(body));
            }
        }
        HarmonyChannel::Final | HarmonyChannel::Unknown => {
            if !body.is_empty() {
                out.push(DemuxEvent::Text(body));
            }
        }
        HarmonyChannel::Commentary { tool_name } => {
            out.push(DemuxEvent::ToolCall {
                name: tool_name.clone(),
                arguments: body,
            });
        }
    }
}

fn parse_harmony_header(header: &str) -> HarmonyChannel {
    // Header shapes we've observed:
    //   "analysis"
    //   "final"
    //   "commentary to=functions.create_file"
    //   "commentary to=functions.create_file json"   (constrain tag)
    //   "commentary" (free-form model commentary, not a tool call)
    let mut parts = header.split_whitespace();
    let name = parts.next().unwrap_or("").to_ascii_lowercase();
    match name.as_str() {
        "analysis" => HarmonyChannel::Analysis,
        "final" => HarmonyChannel::Final,
        "commentary" => {
            for part in parts {
                if let Some(target) = part.strip_prefix("to=") {
                    // Strip the `functions.` namespace prefix Harmony uses.
                    let tool_name = target
                        .strip_prefix("functions.")
                        .unwrap_or(target)
                        .to_string();
                    if !tool_name.is_empty() {
                        return HarmonyChannel::Commentary { tool_name };
                    }
                }
            }
            // Bare `commentary` with no tool target — surface as text so the
            // user sees the model's aside rather than losing it entirely.
            HarmonyChannel::Final
        }
        _ => HarmonyChannel::Unknown,
    }
}

fn parse_hermes_tool_call(body: &str) -> Option<DemuxEvent> {
    // Hermes canonical: {"name":"...", "arguments":{...}}
    // Also supports Qwen's `<function=name>{...}</function>` if caller
    // extracted the body separately, but we handle only the JSON case here.
    let value: serde_json::Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return None,
    };
    let name = value.get("name")?.as_str()?.to_string();
    let arguments = value.get("arguments").cloned().unwrap_or_else(|| {
        value
            .get("parameters")
            .cloned()
            .unwrap_or(serde_json::Value::Object(Default::default()))
    });
    let arguments = if arguments.is_string() {
        arguments.as_str().unwrap_or("").to_string()
    } else {
        serde_json::to_string(&arguments).unwrap_or_else(|_| "{}".to_string())
    };
    Some(DemuxEvent::ToolCall { name, arguments })
}

/// Given a buffer that may end with a partial prefix of `marker`, return how
/// many bytes are safe to emit as text without risking committing a
/// character that turns out to be part of the marker once more bytes arrive.
///
/// Returns `None` if the whole buffer might still be part of a marker prefix
/// (so the caller should wait for more input before emitting anything).
fn safe_emit_boundary(buffer: &str, marker: &str) -> Option<usize> {
    if buffer.is_empty() {
        return Some(0);
    }
    // Largest k < marker.len() such that buffer ends with marker[..k].
    let limit = marker.len().min(buffer.len());
    for k in (1..=limit).rev() {
        if buffer.ends_with(&marker[..k]) {
            return Some(buffer.len() - k);
        }
    }
    Some(buffer.len())
}

fn safe_emit_boundary_multi(buffer: &str, markers: &[&str]) -> Option<usize> {
    markers
        .iter()
        .filter_map(|m| safe_emit_boundary(buffer, m))
        .min()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_harmony_from_gpt_oss() {
        assert_eq!(
            TextFormat::detect_from_model("gpt-oss:20b"),
            TextFormat::Harmony
        );
        assert_eq!(
            TextFormat::detect_from_model("ollama/gpt-oss-120b"),
            TextFormat::Harmony
        );
    }

    #[test]
    fn detect_hermes_from_qwen_coder() {
        assert_eq!(
            TextFormat::detect_from_model("qwen3-coder:30b"),
            TextFormat::HermesXml
        );
        assert_eq!(
            TextFormat::detect_from_model("qwen/qwen2.5-coder-32b"),
            TextFormat::HermesXml
        );
    }

    #[test]
    fn detect_hermes_from_hermes_family() {
        assert_eq!(
            TextFormat::detect_from_model("nous-hermes-2"),
            TextFormat::HermesXml
        );
        assert_eq!(
            TextFormat::detect_from_model("hermes-3-llama"),
            TextFormat::HermesXml
        );
    }

    #[test]
    fn detect_default_for_claude() {
        assert_eq!(
            TextFormat::detect_from_model("claude-3-5-sonnet"),
            TextFormat::Default
        );
    }

    #[test]
    fn default_format_passes_text_through() {
        let mut d = FormatDemuxer::new(TextFormat::Default);
        let out = d.push("hello world");
        assert_eq!(out, vec![DemuxEvent::Text("hello world".into())]);
    }

    #[test]
    fn harmony_final_channel_emits_text() {
        let mut d = FormatDemuxer::new(TextFormat::Harmony);
        let mut evts = Vec::new();
        evts.extend(d.push("<|channel|>final<|message|>Hello there<|end|>"));
        evts.extend(d.finish());
        assert_eq!(evts, vec![DemuxEvent::Text("Hello there".into())]);
    }

    #[test]
    fn harmony_analysis_channel_emits_thinking() {
        let mut d = FormatDemuxer::new(TextFormat::Harmony);
        let mut evts = Vec::new();
        evts.extend(d.push("<|channel|>analysis<|message|>figuring it out<|end|>"));
        evts.extend(d.finish());
        assert_eq!(evts, vec![DemuxEvent::Thinking("figuring it out".into())]);
    }

    #[test]
    fn harmony_commentary_to_functions_emits_tool_call() {
        let mut d = FormatDemuxer::new(TextFormat::Harmony);
        let mut evts = Vec::new();
        evts.extend(d.push(
            "<|channel|>commentary to=functions.create_file<|message|>{\"path\":\"a.js\"}<|call|>",
        ));
        evts.extend(d.finish());
        assert_eq!(
            evts,
            vec![DemuxEvent::ToolCall {
                name: "create_file".into(),
                arguments: "{\"path\":\"a.js\"}".into(),
            }]
        );
    }

    #[test]
    fn harmony_split_across_chunks_at_marker_boundary() {
        let mut d = FormatDemuxer::new(TextFormat::Harmony);
        let mut evts = Vec::new();
        // Split mid-marker: `<|chann` then `el|>final<|message|>ok<|end|>`
        evts.extend(d.push("<|chann"));
        evts.extend(d.push("el|>final<|message|>ok<|end|>"));
        evts.extend(d.finish());
        assert_eq!(evts, vec![DemuxEvent::Text("ok".into())]);
    }

    #[test]
    fn harmony_multi_channel_sequence() {
        let mut d = FormatDemuxer::new(TextFormat::Harmony);
        let mut evts = Vec::new();
        evts.extend(d.push(
            "<|channel|>analysis<|message|>thinking<|end|>\
             <|channel|>commentary to=functions.run<|message|>{\"cmd\":\"ls\"}<|call|>\
             <|channel|>final<|message|>done<|end|>",
        ));
        evts.extend(d.finish());
        assert_eq!(
            evts,
            vec![
                DemuxEvent::Thinking("thinking".into()),
                DemuxEvent::ToolCall {
                    name: "run".into(),
                    arguments: "{\"cmd\":\"ls\"}".into(),
                },
                DemuxEvent::Text("done".into()),
            ]
        );
    }

    #[test]
    fn hermes_tool_call_full() {
        let mut d = FormatDemuxer::new(TextFormat::HermesXml);
        let mut evts = Vec::new();
        evts.extend(d.push(
            "I'll create that file.\n<tool_call>\n{\"name\":\"create_file\",\"arguments\":{\"path\":\"a.js\"}}\n</tool_call>",
        ));
        evts.extend(d.finish());
        assert_eq!(
            evts,
            vec![
                DemuxEvent::Text("I'll create that file.\n".into()),
                DemuxEvent::ToolCall {
                    name: "create_file".into(),
                    arguments: "{\"path\":\"a.js\"}".into(),
                },
            ]
        );
    }

    #[test]
    fn hermes_split_at_opening_tag() {
        let mut d = FormatDemuxer::new(TextFormat::HermesXml);
        let mut evts = Vec::new();
        evts.extend(d.push("Ok "));
        evts.extend(d.push("<tool_"));
        evts.extend(d.push("call>{\"name\":\"x\",\"arguments\":{}}</tool_call>"));
        evts.extend(d.finish());
        assert_eq!(
            evts,
            vec![
                DemuxEvent::Text("Ok ".into()),
                DemuxEvent::ToolCall {
                    name: "x".into(),
                    arguments: "{}".into(),
                },
            ]
        );
    }

    #[test]
    fn hermes_leading_text_before_tag() {
        let mut d = FormatDemuxer::new(TextFormat::HermesXml);
        let mut evts = Vec::new();
        evts.extend(d.push("Plain text, no tools here."));
        evts.extend(d.finish());
        assert_eq!(evts, vec![DemuxEvent::Text("Plain text, no tools here.".into())]);
    }

    #[test]
    fn hermes_malformed_closing_tag_falls_back_to_text() {
        let mut d = FormatDemuxer::new(TextFormat::HermesXml);
        let mut evts = Vec::new();
        evts.extend(d.push("<tool_call>{\"name\":\"x\""));
        // stream ends without `</tool_call>` — finish() should not swallow it.
        evts.extend(d.finish());
        assert!(evts.iter().any(|e| matches!(e, DemuxEvent::Text(s) if s.contains("tool_call"))));
    }
}
