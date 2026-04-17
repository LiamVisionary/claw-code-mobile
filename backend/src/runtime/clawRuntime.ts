import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createLineBuffer } from "../utils/lineBuffer";
import { logger } from "../utils/logger";
import { eventsService } from "../services/eventsService";
import { messageService } from "../services/messageService";
import { streamService } from "../services/streamService";
import { threadService } from "../services/threadService";
import { terminalService } from "../services/terminalService";
import { runService } from "../services/runService";
import { createId } from "../utils/ids";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Binary lives in an out-of-project cache dir so Metro's file watcher never
// sees cargo's transient build artifacts. Kept in sync with scripts/build-claw.sh.
const CLAW_BINARY =
  process.env.CLAW_BINARY ||
  path.join(
    process.env.CLAW_TARGET_DIR ||
      path.join(process.env.HOME || "", ".cache/claw-code-mobile/target"),
    "debug/claw"
  );

// Official Claude CLI binary — used for OAuth-authenticated models because
// Anthropic's API validates the system prompt and rejects non-official clients
// for Opus/Sonnet on Max subscriptions. The official binary passes this check.
const CLAUDE_CLI =
  process.env.CLAUDE_CLI || "claude";

// Map thread ID → Claude CLI session ID for conversation continuity.
// The Claude CLI returns a session_id in its JSON output; we pass it
// back via --resume on subsequent turns so the model sees history.
const claudeCliSessions = new Map<string, string>();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const WORKSPACES_DIR = path.resolve(__dirname, "../../data/workspaces");

fs.mkdirSync(WORKSPACES_DIR, { recursive: true });

export type ModelConfig = {
  provider: "claude" | "openrouter" | "local";
  name?: string;
  apiKey?: string;
  /** When "oauth", the apiKey is treated as an ANTHROPIC_AUTH_TOKEN (bearer)
   *  instead of an x-api-key header. */
  authMethod?: "apiKey" | "oauth";
  /** OAuth token set – used when authMethod is "oauth". */
  oauthToken?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
  };
};

export type Attachment = {
  /** Absolute path on disk (already saved by the uploads router). */
  path: string;
  /** Original filename — shown in the chat bubble and in the agent prompt. */
  fileName: string;
  /** Path relative to the thread's cwd, for the agent's filesystem tools. */
  relativePath: string;
  /** Categorization picked by the uploads router. */
  kind: "image" | "file";
  mimeType?: string;
  size?: number;
};

type ActiveRun = {
  runId: string;
  child: ReturnType<typeof spawn> | null;
  stopped: boolean;
  /** Tool step IDs already emitted in real-time from stderr, so processSuccess can skip them. */
  realtimeStepIds: Set<string>;
  /** True when we've received at least one [stream] text_delta event from stderr,
   *  meaning the response text was streamed in real-time and processSuccess should
   *  NOT re-stream it via streamWords. */
  streamedText: boolean;
  /** Accumulated thinking content from real-time [stream] thinking_delta events. */
  streamedThinking: string;
  /**
   * The message ID for the current agentic turn bubble. Rotates on the
   * first text_delta that follows one or more tool calls — so each chat
   * bubble contains one "thought + the actions it drove". The tools
   * stay attached to the bubble whose text initiated them, not the
   * bubble that reports results afterwards.
   */
  currentMessageId: string;
  /** True once a tool_start has been seen since the last text_delta. */
  hadToolSinceLastText: boolean;
  /** All message IDs created during this run (initial + any new bubbles), for finalization. */
  allMessageIds: string[];
  /** Per-turn metadata collected during the run and persisted on finalize. */
  startedAt: number;
  turnLog: string[];
  turnToolSteps: {
    id: string;
    tool: string;
    label: string;
    status: "done" | "error";
  }[];
  turnTokensIn?: number;
  turnTokensOut?: number;
  turnCostUsd?: number;
  turnModel?: string;
};

type SpawnResult = {
  succeeded: boolean;
  stdoutBuf: string;
  stderrBuf: string;
  stopped: boolean;
};

const activeRuns = new Map<string, ActiveRun>();

export type RunPhase = "idle" | "thinking" | "compacting" | "responding";

const runPhases = new Map<string, RunPhase>();

function setRunPhase(threadId: string, phase: RunPhase) {
  const prev = runPhases.get(threadId) ?? "idle";
  if (prev === phase) return; // no-op — skip redundant publishes
  if (phase === "idle") {
    runPhases.delete(threadId);
  } else {
    runPhases.set(threadId, phase);
  }
  streamService.publish(threadId, { type: "run_phase", phase });
}

export function getRunPhase(threadId: string): RunPhase {
  return runPhases.get(threadId) ?? "idle";
}

function workspaceDir(threadId: string): string {
  const dir = path.join(WORKSPACES_DIR, threadId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve the working directory for a thread — its configured `workDir`
 * if it exists on disk, otherwise the per-thread workspace fallback
 * under `data/workspaces/<id>`. Used by the uploads router so saved
 * attachments land in the same directory the agent will execute in.
 */
export function resolveThreadCwd(threadId: string): string {
  const thread = threadService.get(threadId);
  if (thread?.workDir && fs.existsSync(thread.workDir)) {
    return thread.workDir;
  }
  return workspaceDir(threadId);
}

function buildEnv(
  model?: ModelConfig,
  sessionDir?: string
): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;

  // Claw embeds the full `git diff` (staged + unstaged) into its system
  // prompt — on a repo with large uncommitted changes this easily adds
  // 50-60K tokens to EVERY API call. Without Anthropic prompt caching
  // (not available through OpenRouter), this is paid at full price on
  // each spawn. Setting GIT_DIFF_LIMIT to "0" tells git to skip the
  // binary diff stat, but claw calls `git diff` directly. Instead, we
  // point GIT_EXTERNAL_DIFF at /bin/true so `git diff` always returns
  // empty, and GIT_DIFF_OPTS to limit context. These are respected by
  // the git CLI that claw shells out to.
  env["GIT_EXTERNAL_DIFF"] = "/bin/true";

  if (model?.apiKey || model?.oauthToken) {
    if (model.provider === "openrouter") {
      env["OPENAI_API_KEY"] = model.apiKey ?? "";
      env["OPENAI_BASE_URL"] = "https://openrouter.ai/api/v1";
      delete env["ANTHROPIC_API_KEY"];
      delete env["ANTHROPIC_AUTH_TOKEN"];
    } else if (model.authMethod === "oauth") {
      // OAuth-authenticated Claude model: the official Claude CLI
      // handles auth internally (reads ~/.claude/.credentials.json).
      // No env vars needed — just clear any conflicting ones.
      delete env["ANTHROPIC_API_KEY"];
      delete env["ANTHROPIC_AUTH_TOKEN"];
      delete env["OPENAI_API_KEY"];
      delete env["OPENAI_BASE_URL"];
    } else {
      env["ANTHROPIC_API_KEY"] = model.apiKey ?? "";
      delete env["OPENAI_API_KEY"];
      delete env["OPENAI_BASE_URL"];
    }
  }

  if (model?.name) {
    env["CLAW_MODEL"] = model.name;
  }

  if (sessionDir && !(model?.authMethod === "oauth")) {
    env["CLAW_SESSION_DIR"] = sessionDir;
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  return env;
}

function isOAuthModel(model?: ModelConfig): boolean {
  return model?.authMethod === "oauth" && !!model?.oauthToken;
}

function getBinary(model?: ModelConfig): string {
  // Use the official Claude CLI for OAuth models (Max subscription) —
  // Anthropic blocks non-official clients for Opus/Sonnet.
  if (isOAuthModel(model) && fs.existsSync(CLAUDE_CLI)) {
    return CLAUDE_CLI;
  }
  return CLAW_BINARY;
}

function buildArgs(
  prompt: string,
  model?: ModelConfig,
  attachments: Attachment[] = [],
  threadId?: string
): string[] {
  const useClaudeCli = isOAuthModel(model) && fs.existsSync(CLAUDE_CLI);
  const args: string[] = ["--output-format", "json"];
  if (model?.name) args.push("--model", model.name);

  if (useClaudeCli) {
    args.push("--permission-mode", "dontAsk");
    // Resume previous Claude CLI session for conversation continuity
    const sessionId = threadId ? claudeCliSessions.get(threadId) : undefined;
    if (sessionId) {
      args.push("--resume", sessionId);
    }
  } else {
    args.push("--permission-mode", "danger-full-access");
  }

  // `--image` flags are positional-agnostic but conventionally placed
  // before the `prompt` subcommand. Each pushes one image into the
  // current turn's user message as a multimodal content block.
  for (const att of attachments) {
    if (att.kind === "image") {
      args.push("--image", att.path);
    }
  }

  if (useClaudeCli) {
    args.push("-p", prompt);
  } else {
    args.push("prompt", prompt);
  }
  return args;
}

/**
 * Build the effective prompt text the model sees. Image attachments
 * already ride along as `--image` flags (so the model literally sees
 * the pixels via the multimodal content block); non-image files get a
 * short note prepended so the agent knows the file exists in the
 * workdir and can open it with its filesystem tools.
 */
function decoratePromptWithAttachments(
  prompt: string,
  attachments: Attachment[]
): string {
  if (attachments.length === 0) return prompt;
  const images = attachments.filter((a) => a.kind === "image");
  const files = attachments.filter((a) => a.kind === "file");
  const lines: string[] = [];
  if (images.length > 0) {
    const names = images.map((a) => a.fileName).join(", ");
    lines.push(
      `(${images.length} image${images.length === 1 ? "" : "s"} attached: ${names})`
    );
  }
  if (files.length > 0) {
    for (const f of files) {
      lines.push(`(attached file: ${f.relativePath})`);
    }
  }
  if (lines.length === 0) return prompt;
  return `${lines.join("\n")}\n\n${prompt}`;
}

function buildCompactArgs(model?: ModelConfig): string[] {
  const args: string[] = [];
  if (model?.name) args.push("--model", model.name);
  args.push("--output-format", "json", "--resume", "latest", "/compact");
  return args;
}

/**
 * Deliver the completed response text to the client.
 *
 * When `streamingEnabled = true` (default) the text is sent word-by-word with
 * a short delay so the user sees it appear gradually — similar to how a
 * real-time model would stream.
 *
 * When `streamingEnabled = false` the entire text is delivered in a single
 * delta so the bubble appears instantly.
 */
async function streamWords(
  threadId: string,
  messageId: string,
  text: string,
  stopped: () => boolean,
  streamingEnabled = true
): Promise<void> {
  if (!streamingEnabled || !text) {
    // Instant mode — one delta for the full text
    if (text) {
      messageService.appendAssistantDelta(threadId, messageId, text);
      streamService.publish(threadId, { type: "delta", messageId, chunk: text });
    }
    return;
  }

  const words = text.split(/(\s+)/);
  for (const word of words) {
    if (stopped()) break;
    if (!word) continue;
    messageService.appendAssistantDelta(threadId, messageId, word);
    streamService.publish(threadId, { type: "delta", messageId, chunk: word });
    await new Promise((r) => setTimeout(r, 18));
  }
}

/** Emit a line to both terminal service and the SSE stream. */
function emitTerminal(threadId: string, line: string) {
  terminalService.appendChunk(threadId, line);
  streamService.publish(threadId, { type: "terminal", chunk: line + "\n" });
  // Capture into the active run's per-turn log so it can be persisted
  // on finalize. Bounded so a runaway tool doesn't blow up the blob.
  const active = activeRuns.get(threadId);
  if (active) {
    active.turnLog.push(line);
    if (active.turnLog.length > 800) active.turnLog.splice(0, active.turnLog.length - 800);
  }
}

/**
 * Spawn claw once with the given model config. Resolves with a SpawnResult
 * so the caller can decide whether to retry with a fallback model.
 */
function spawnOnce(
  threadId: string,
  content: string,
  cwd: string,
  sessionDir: string,
  model: ModelConfig | undefined,
  active: ActiveRun,
  isCompact = false,
  messageId?: string,
  attachments: Attachment[] = []
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    // For the Claude CLI, check if there's an existing session to resume
      const args = isCompact
      ? buildCompactArgs(model)
      : buildArgs(content, model, attachments, threadId);
    const env = buildEnv(model, sessionDir);
    const binary = getBinary(model);
    const isClaudeCli = binary === CLAUDE_CLI;
    logger.info({
      threadId,
      cwd,
      model: model?.name ?? model?.provider,
      args,
      binary,
      isClaudeCli,
      authMethod: model?.authMethod,
    }, "Spawning process");

    eventsService.record({
      source: "runtime",
      type: "spawn_detail",
      threadId,
      runId: active.runId,
      payload: {
        binary,
        isClaudeCli,
        args,
        cwd,
        authMethod: model?.authMethod,
        hasOauthToken: !!model?.oauthToken,
        envKeys: Object.keys(env).filter(k =>
          k.startsWith("ANTHROPIC") || k.startsWith("OPENAI") || k.startsWith("CLAW") || k === "GIT_EXTERNAL_DIFF"
        ),
      },
    });

    const child = spawn(binary, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    active.child = child;

    let stdoutBuf = "";
    let stderrBuf = "";

    // Track the current "open" tool step so we can emit tool_end when it completes.
    // Map from tool name to the most recent stepId that was started but not yet ended.
    const openSteps = new Map<string, string>();

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
    });

    // Line-aware buffering for stderr — see utils/lineBuffer.ts for why.
    // The short version: a single claw `[stream]{…}` event can span
    // multiple child-process chunks; if we don't accumulate across
    // chunks before splitting on "\n", the JSON.parse fragments on
    // both sides of every chunk boundary fail and silently drop the
    // event. That's how we ended up with "chat an AI" / "code, files"
    // in assistant responses. Any partial line on close is flushed.
    const stderrLines = createLineBuffer((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      // Don't send internal [stream] protocol lines to the terminal view
      if (!trimmed.startsWith("[stream]")) {
        emitTerminal(threadId, trimmed);
      }
      // Parse real-time streaming events and hook progress events from stderr.
      // Claw writes two kinds of structured lines:
      //   [stream]{"type":"text_delta","text":"Hello"}   — real-time streaming
      //   [hook PreToolUse] bash: ls -la                 — hook progress
      if (messageId && !isCompact) {
        parseStreamEvent(trimmed, threadId, active, openSteps);
        parseHookEvent(trimmed, threadId, active, openSteps);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuf += text;
      stderrLines.push(text);
    });

    child.on("close", (code) => {
      stderrLines.flush();

      eventsService.record({
        source: "runtime",
        type: "spawn_exit",
        threadId,
        runId: active.runId,
        payload: {
          binary,
          isClaudeCli,
          exitCode: code,
          stopped: active.stopped,
          stdoutLen: stdoutBuf.length,
          stderrLen: stderrBuf.length,
          stdoutPreview: stdoutBuf.slice(0, 500),
          stderrPreview: stderrBuf.slice(0, 500),
        },
      });

      if (active.stopped) {
        resolve({ succeeded: false, stdoutBuf, stderrBuf, stopped: true });
        return;
      }
      resolve({ succeeded: code === 0, stdoutBuf, stderrBuf, stopped: false });
    });

    child.on("error", (err) => {
      logger.error({ err, binary, isClaudeCli }, "Failed to spawn process");
      eventsService.record({
        source: "runtime",
        type: "spawn_error",
        threadId,
        runId: active.runId,
        payload: { binary, isClaudeCli, error: err.message },
      });
      resolve({ succeeded: false, stdoutBuf, stderrBuf: err.message, stopped: false });
    });
  });
}

/**
 * Parse a claw hook progress line from stderr and emit real-time tool_start / tool_end SSE events.
 *
 * Claw writes lines like:
 *   [hook PreToolUse] bash: ls -la          ← tool about to run
 *   [hook done PreToolUse] bash: ls -la      ← pre-hook completed (tool executing)
 *   [hook PostToolUse] bash: ls -la          ← tool finished, post-hook starting
 *   [hook done PostToolUse] bash: ls -la     ← post-hook completed (tool fully done)
 *   [hook cancelled PostToolUse] bash: ...   ← tool cancelled
 *
 * We emit `tool_start` when we see `PreToolUse` (tool is about to execute) and
 * `tool_end` when we see `done PostToolUse` or `cancelled PostToolUse` (tool finished).
 */

/**
 * Parse a `[stream]` NDJSON line from stderr and emit real-time SSE events.
 *
 * When running with `--output-format json`, claw emits structured events to
 * stderr as they happen so the TS backend can stream text/thinking/tools
 * in real-time instead of waiting for the full JSON blob on stdout.
 *
 * Format: `[stream]{"type":"text_delta","text":"Hello"}`
 *         `[stream]{"type":"thinking_delta","thinking":"I need to..."}`
 *         `[stream]{"type":"tool_start","id":"toolu_xxx","name":"bash","input":"ls"}`
 */
function parseStreamEvent(
  line: string,
  threadId: string,
  active: ActiveRun,
  openSteps: Map<string, string>,
): void {
  const prefix = "[stream]";
  if (!line.startsWith(prefix)) return;
  const jsonStr = line.slice(prefix.length);
  logger.info({ jsonStr: jsonStr.slice(0, 200), threadId }, "[stream] event received");
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return; // not valid JSON — skip
  }

  const type = payload.type as string | undefined;
  if (!type) return;

  switch (type) {
    case "text_delta": {
      const text = payload.text as string | undefined;
      if (!text) break;

      // Bubble rotation: if we've already streamed text AND the model
      // fired at least one tool since, this text is a NEW thought block
      // — open a fresh bubble for it so each "thought + its actions"
      // pair gets its own row in the chat.
      if (active.hadToolSinceLastText && active.streamedText) {
        const newMsgId = createId("msg");
        active.currentMessageId = newMsgId;
        active.allMessageIds.push(newMsgId);
        active.streamedThinking = "";
      }
      active.hadToolSinceLastText = false;
      active.streamedText = true;

      const msgId = active.currentMessageId;
      // Transition from thinking → responding when text starts flowing
      setRunPhase(threadId, "responding");
      // Update the server-side message store and publish delta to SSE
      messageService.appendAssistantDelta(threadId, msgId, text);
      streamService.publish(threadId, { type: "delta", messageId: msgId, chunk: text });
      break;
    }
    case "thinking_delta": {
      const thinking = payload.thinking as string | undefined;
      if (!thinking) break;
      // Same rotation as text_delta: first thinking block after a tool
      // run is a new thought cycle.
      if (active.hadToolSinceLastText && active.streamedText) {
        const newMsgId = createId("msg");
        active.currentMessageId = newMsgId;
        active.allMessageIds.push(newMsgId);
        active.streamedThinking = "";
        active.hadToolSinceLastText = false;
      }
      active.streamedThinking += thinking;
      // Publish incremental thinking content to SSE (scoped to current bubble)
      streamService.publish(threadId, {
        type: "thinking_content",
        messageId: active.currentMessageId,
        content: active.streamedThinking,
      });
      break;
    }
    case "tool_start": {
      const id = (payload.id as string) ?? `step-${Date.now()}`;
      const name = (payload.name as string) ?? "unknown";
      const rawInput = payload.input;
      const input = typeof rawInput === "string"
        ? rawInput
        : rawInput != null ? JSON.stringify(rawInput) : "";
      const stepId = `step-${name}-${id}`;
      const label = toolLabel(name, payload.input) || input || name;

      // Mark that a tool fired — the NEXT text_delta will rotate to a
      // fresh bubble (see text_delta handler above).
      active.hadToolSinceLastText = true;

      // A tool call means the model is reasoning / acting, not streaming
      // a user-facing response. Flip the indicator label back to
      // "thinking" so the UI oscillates correctly between tool cycles.
      setRunPhase(threadId, "thinking");

      const detail = typeof rawInput === "string"
        ? rawInput.slice(0, 300)
        : rawInput != null ? JSON.stringify(rawInput).slice(0, 300) : undefined;
      streamService.publish(threadId, {
        type: "tool_start",
        id: stepId,
        messageId: active.currentMessageId,
        tool: name,
        label: label.slice(0, 80),
        detail,
      });
      openSteps.set(name, stepId);
      active.realtimeStepIds.add(stepId);
      break;
    }
  }
}

function parseHookEvent(
  line: string,
  threadId: string,
  active: ActiveRun,
  openSteps: Map<string, string>,
): void {
  // Match: [hook <status>] <tool_name>: <command>
  // Where <status> is one of: pre_tool, done pre_tool, post_tool, done post_tool, cancelled post_tool
  const hookMatch = line.match(
    /^\[hook\s+(done\s+|cancelled\s+)?(\w+)\]\s+(\w+)(?::\s+(.*))?$/
  );
  if (!hookMatch) return;

  const doneOrCancelled = hookMatch[1]?.trim() ?? ""; // "done", "cancelled", or ""
  const hookPhase = hookMatch[2]; // "PreToolUse", "PostToolUse", "PostToolUseFailure"
  const toolName = hookMatch[3];
  const command = hookMatch[4] ?? "";

  if (hookPhase === "PreToolUse" && !doneOrCancelled) {
    // Tool is about to start executing → emit tool_start
    // But skip if already emitted via [stream] tool_start (the openSteps entry
    // will already exist from parseStreamEvent).
    if (openSteps.has(toolName)) return;
    const stepId = `step-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const label = command || toolName;

    // Mark the tool firing so the next text/thinking delta rotates.
    active.hadToolSinceLastText = true;
    // Tool call means the model is reasoning / acting — flip label back
    // to "thinking" so the indicator oscillates correctly.
    setRunPhase(threadId, "thinking");

    streamService.publish(threadId, {
      type: "tool_start",
      id: stepId,
      messageId: active.currentMessageId,
      tool: toolName,
      label: label.slice(0, 80),
    });
    openSteps.set(toolName, stepId);
    active.realtimeStepIds.add(stepId);
  } else if (
    (hookPhase === "PostToolUse" && (doneOrCancelled === "done" || doneOrCancelled === "cancelled")) ||
    (hookPhase === "PostToolUseFailure" && (doneOrCancelled === "done" || doneOrCancelled === "cancelled"))
  ) {
    // Tool finished (or failed) → emit tool_end
    const stepId = openSteps.get(toolName);
    if (stepId) {
      const isError = hookPhase === "PostToolUseFailure" || doneOrCancelled === "cancelled";
      streamService.publish(threadId, {
        type: "tool_end",
        id: stepId,
        messageId: active.currentMessageId,
        ...(isError ? { error: true } : {}),
      });
      openSteps.delete(toolName);
    }
  } else if (hookPhase === "PreToolUse" && doneOrCancelled === "cancelled") {
    // PreToolUse hook cancelled the tool — close the running step with error
    const stepId = openSteps.get(toolName);
    if (stepId) {
      streamService.publish(threadId, {
        type: "tool_end",
        id: stepId,
        messageId: active.currentMessageId,
        error: true,
      });
      openSteps.delete(toolName);
    }
  }
}

/**
 * Extract a clean error message from claw's stdout/stderr.
 * Claw sometimes writes structured JSON to stderr or stdout on error exit.
 * Also detects context-window overflow and returns a user-friendly message.
 */
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;

function isRetryableError(errText: string): boolean {
  const lower = errText.toLowerCase();
  return (
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("429") ||
    lower.includes("rate") ||
    lower.includes("too many requests") ||
    lower.includes("too quickly") ||
    lower.includes("provider_unavailable") ||
    lower.includes("overloaded") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("request rate")
  );
}

function extractClawError(stdoutBuf: string, stderrBuf: string): string {
  // Try parsing stderr as JSON first (claw writes error JSON there)
  for (const raw of [stderrBuf, stdoutBuf]) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Sometimes there's leading non-JSON (e.g. progress lines) before the JSON blob
    const jsonStart = trimmed.lastIndexOf("{");
    if (jsonStart !== -1) {
      try {
        const parsed = JSON.parse(trimmed.slice(jsonStart)) as Record<string, unknown>;
        const msg = (parsed["message"] ?? parsed["error"] ?? "") as string;
        if (msg) {
          if (isContextOverflow(msg)) return formatContextOverflow();
          return msg.split("\n")[0].trim() || msg;
        }
      } catch {
        // not JSON — continue
      }
    }
    // Plain text — check for context overflow keywords
    if (isContextOverflow(trimmed)) return formatContextOverflow();
  }

  // Fallback: first meaningful stderr line (avoids slicing mid-word)
  const firstLine = stderrBuf
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine) {
    if (isContextOverflow(firstLine)) return formatContextOverflow();
    return firstLine;
  }

  return "claw exited with an error";
}

function isContextOverflow(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("context_window_blocked") ||
    lower.includes("context window") ||
    lower.includes("contextwindowexceeded") ||
    lower.includes("context length") ||
    lower.includes("maximum context length") ||
    lower.includes("too many tokens") ||
    lower.includes("prompt is too long") ||
    lower.includes("input is too long") ||
    lower.includes("request is too large") ||
    lower.includes("exceeds the model") ||
    lower.includes("token limit")
  );
}

/**
 * Rough tokens estimate from a session file's byte count. Assumes JSON-
 * encoded conversation with ~3.5 bytes per token average for English
 * mixed with tool JSON — good enough for "~X tokens freed" display.
 */
/**
 * Snapshot every `.jsonl` file under the session directory so a failed
 * model attempt can be rolled back cleanly. Without this, each failed
 * spawn leaves data in the session that the next model reads — inflating
 * token counts and cost for every fallback attempt.
 */
function snapshotSession(
  sessionDir: string
): Map<string, Buffer> | null {
  const sessionsRoot = path.join(sessionDir, "sessions");
  if (!fs.existsSync(sessionsRoot)) return null;
  const snap = new Map<string, Buffer>();
  try {
    for (const sub of fs.readdirSync(sessionsRoot)) {
      const subPath = path.join(sessionsRoot, sub);
      if (!fs.statSync(subPath).isDirectory()) continue;
      for (const entry of fs.readdirSync(subPath)) {
        if (!entry.endsWith(".jsonl")) continue;
        const filePath = path.join(subPath, entry);
        snap.set(filePath, fs.readFileSync(filePath));
      }
    }
  } catch {
    return null;
  }
  return snap.size > 0 ? snap : null;
}

function restoreSession(snap: Map<string, Buffer> | null): void {
  if (!snap) return;
  for (const [filePath, data] of snap) {
    try {
      fs.writeFileSync(filePath, data);
    } catch {
      // Best-effort — if the file was deleted, skip
    }
  }
}

function sessionBytes(sessionDir: string): number {
  return analyzeSessionBreakdown(sessionDir)?.totalBytes ?? 0;
}

/**
 * Finalize a compact operation: compute tokens-freed delta, persist a
 * user-visible "Compacted context" system message to SQLite so it
 * survives refresh, and return the publish-ready payload for SSE.
 */
function finalizeCompact(
  threadId: string,
  sessionDir: string,
  bytesBefore: number,
  succeeded: boolean,
  info: { removedMessages: number; keptMessages: number },
): {
  removedMessages: number;
  keptMessages: number;
  approxTokensFreed: number;
  systemMessage?: {
    id: string;
    threadId: string;
    content: string;
    createdAt: string;
  };
} {
  const bytesAfter = sessionBytes(sessionDir);
  const bytesFreed = Math.max(0, bytesBefore - bytesAfter);
  const approxTokensFreed = Math.round(bytesFreed / 3.5);
  let content: string;
  if (!succeeded) {
    content = "⚠ Compaction failed";
  } else if (info.removedMessages > 0) {
    const tokStr = approxTokensFreed > 0
      ? ` (~${approxTokensFreed.toLocaleString()} tokens freed)`
      : "";
    content = `Compacted context — removed ${info.removedMessages} messages, kept ${info.keptMessages}${tokStr}`;
  } else {
    content = "Compaction ran — nothing to remove";
  }
  const msg = messageService.addSystemMessage(threadId, content);
  return {
    ...info,
    approxTokensFreed,
    systemMessage: {
      id: msg.id,
      threadId: msg.threadId,
      content: msg.content,
      createdAt: msg.createdAt,
    },
  };
}

function parseCompactResult(stdoutBuf: string): { removedMessages: number; keptMessages: number } {
  try {
    const trimmed = stdoutBuf.trim();
    const jsonStart = trimmed.lastIndexOf("{");
    if (jsonStart !== -1) {
      const parsed = JSON.parse(trimmed.slice(jsonStart)) as Record<string, unknown>;
      if (parsed["kind"] === "compact") {
        return {
          removedMessages: (parsed["removed_messages"] as number) ?? 0,
          keptMessages: (parsed["kept_messages"] as number) ?? 0,
        };
      }
    }
  } catch {}
  const removedMatch = stdoutBuf.match(/removed\s+(\d+)/i);
  const keptMatch = stdoutBuf.match(/kept\s+(\d+)/i);
  if (removedMatch || keptMatch) {
    return {
      removedMessages: removedMatch ? parseInt(removedMatch[1], 10) : 0,
      keptMessages: keptMatch ? parseInt(keptMatch[1], 10) : 0,
    };
  }
  return { removedMessages: 0, keptMessages: 0 };
}

function formatContextOverflow(): string {
  return [
    "⚠ Context window is full — the conversation is too long for the model to continue.",
    "",
    "Options:",
    "  • Start a new thread for a fresh session",
    "  • Type /compact in your next message to summarize and continue",
    "  • Ask a shorter or more focused question to reduce token usage",
  ].join("\n");
}

/**
 * Map raw claw/model error strings to user-readable messages.
 * Keeps technical noise out of the chat bubble.
 */
function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes("no content") ||
    lower.includes("stream produced no content") ||
    lower.includes("empty response") ||
    lower.includes("assistant stream")
  ) {
    return "The model returned an empty response. This can happen with some OpenRouter models — please try again or switch to a different model in Settings.";
  }
  if (lower.includes("rate limit") || lower.includes("ratelimit") || lower.includes("429")) {
    return "Rate limit reached. Please wait a moment before sending another message.";
  }
  if (lower.includes("invalid api key") || lower.includes("unauthorized") || lower.includes("401")) {
    return "Invalid API key. Please check your API key in Settings.";
  }
  if (lower.includes("402") || lower.includes("payment required") || lower.includes("more credits") || lower.includes("can only afford")) {
    return "Insufficient API credits. Please add credits to your OpenRouter account and try again.";
  }
  if (lower.includes("context length") || lower.includes("context window")) {
    return formatContextOverflow();
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "The request timed out. Please try again.";
  }
  if (lower.includes("error decoding response body") || lower.includes("hyper::error")) {
    return "Failed to read the model's response — the connection may have dropped. Please try again.";
  }
  // Pass through short plain-text messages; truncate long ones
  if (raw.length <= 200) return raw;
  return raw.slice(0, 200) + "…";
}

/** Derive a human-readable label from a tool_use input object. */
function toolLabel(toolName: string, input: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  const path = (inp["file_path"] as string ?? inp["path"] as string ?? "").slice(0, 80);
  switch (toolName) {
    // Shell
    case "bash":
    case "Bash":
      return (inp["command"] as string ?? "").slice(0, 80);
    // File reading
    case "read":
    case "Read":
    case "read_file":
    case "view":
    case "cat":
      return path;
    // File writing / editing
    case "edit":
    case "Edit":
    case "edit_file":
    case "str_replace_editor":
      return path;
    case "write":
    case "Write":
    case "write_file":
    case "create":
    case "create_file":
      return path;
    // Search
    case "grep":
    case "Grep":
    case "grep_search":
    case "search":
    case "Search":
    case "search_files":
      return (inp["pattern"] as string ?? inp["query"] as string ?? "").slice(0, 80);
    case "web_search":
    case "WebSearch":
      return (inp["query"] as string ?? inp["q"] as string ?? "").slice(0, 80);
    // Directory navigation
    case "glob":
    case "Glob":
    case "glob_search":
      return (inp["pattern"] as string ?? "").slice(0, 80);
    case "ls":
    case "list_directory":
      return path || ".";
    // Git
    case "git":
      return (inp["command"] as string ?? inp["args"] as string ?? "").slice(0, 80);
    default:
      return JSON.stringify(input ?? {}).slice(0, 60);
  }
}

/** Parse claw's JSON stdout and emit tool/cost lines + stream the message. */
async function processSuccess(
  threadId: string,
  messageId: string,
  stdoutBuf: string,
  active: ActiveRun,
  streamingEnabled = true
): Promise<void> {
  const raw = JSON.parse(stdoutBuf.trim());

  // Claude CLI returns { type: "result", result: "...", session_id: "..." }
  // Claw returns { message: "...", tool_uses: [...], ... }
  if (raw.session_id) {
    claudeCliSessions.set(threadId, raw.session_id);
  }

  // Normalize Claude CLI output to claw format
  const result = raw as {
    type?: string;
    subtype?: string;
    message: string;
    result?: string;
    is_error?: boolean;
    // Claw emits { id, name, input } — note: "name", NOT "tool_name"
    tool_uses?: Array<{ id?: string; name: string; input: unknown }>;
    tool_results?: Array<{ content: string }>;
    usage?: { input_tokens: number; output_tokens: number };
    estimated_cost?: string;
    total_cost_usd?: number;
  };

  // Claude CLI uses "result" field instead of "message"
  if (result.result !== undefined && result.message === undefined) {
    result.message = result.result;
  }
  // Claude CLI uses total_cost_usd instead of estimated_cost
  if (result.total_cost_usd !== undefined && !result.estimated_cost) {
    result.estimated_cost = `$${result.total_cost_usd.toFixed(4)}`;
  }

  if (result.type === "error" || result.is_error) {
    const raw = (result.message ?? "").trim();
    const msg = raw || "claw reported an error";
    const overflow = isContextOverflow(msg);
    throw Object.assign(new Error(overflow ? formatContextOverflow() : msg.split("\n")[0].trim() || msg), {
      isClawError: true,
      isContextOverflow: overflow,
    });
  }

  // Emit tool_start / tool_end events for tools that were NOT already
  // emitted in real-time from stderr hook events.
  // Each tool gets a brief "running" window (spinner visible) before done.
  const toolUses = result.tool_uses ?? [];
  const hadRealtimeTools = active.realtimeStepIds.size > 0;
  for (const tu of toolUses) {
    if (active.stopped) break;
    const toolName = tu.name ?? "unknown";
    const label = toolLabel(toolName, tu.input) || toolName;

    // Check if this tool was already emitted in real-time via stderr hooks.
    // The realtime step IDs are keyed by tool name, so we look for any
    // step ID that starts with `step-${toolName}-`.
    const alreadyEmitted = [...active.realtimeStepIds].some(
      (id) => id.startsWith(`step-${toolName}-`)
    );

    if (alreadyEmitted) {
      // Tool was already shown in real-time. Close the matching step so
      // the client badge transitions from "running" to "done" — claw's
      // stream feed only emits tool_start, never tool_end, so without this
      // publish the badge stays in "running" state forever on the client
      // and the ThinkingIndicator ends up with a pile of spinning badges.
      let matchedStepId: string | null = null;
      for (const id of active.realtimeStepIds) {
        if (id.startsWith(`step-${toolName}-`)) {
          matchedStepId = id;
          active.realtimeStepIds.delete(id);
          break;
        }
      }
      if (matchedStepId) {
        streamService.publish(threadId, {
          type: "tool_end",
          id: matchedStepId,
          messageId,
        });
        active.turnToolSteps.push({
          id: matchedStepId,
          tool: toolName,
          label,
          status: "done",
        });
      }
      continue;
    }

    const stepId = `step-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const detail = JSON.stringify(tu.input ?? {}).slice(0, 300);
    streamService.publish(threadId, {
      type: "tool_start",
      id: stepId,
      messageId,
      tool: toolName,
      label,
      detail,
    });
    active.turnToolSteps.push({
      id: stepId,
      tool: toolName,
      label,
      detail,
      status: "done",
    });
    await sleep(90);
    streamService.publish(threadId, {
      type: "tool_end",
      id: stepId,
      messageId,
    });
    await sleep(55);
  }
  if (toolUses.length > 0 && !active.stopped) {
    await sleep(hadRealtimeTools ? 50 : 220);
  }
  // Capture usage onto the active run so finalize can persist it.
  const inTok = result.usage?.input_tokens ?? 0;
  const outTok = result.usage?.output_tokens ?? 0;
  if (typeof result.usage?.input_tokens === "number") {
    active.turnTokensIn = result.usage.input_tokens;
  }
  if (typeof result.usage?.output_tokens === "number") {
    active.turnTokensOut = result.usage.output_tokens;
  }

  // Calculate cost from real OpenRouter pricing instead of claw's
  // hardcoded Anthropic rates — claw can be 40-50x off for non-Anthropic
  // models.
  const realCost = calculateRealCost(active.turnModel, inTok, outTok);
  const costDisplay = realCost ?? result.estimated_cost;
  const savingsLine = buildSavingsLine(active.turnModel, inTok, outTok);
  if (costDisplay) {
    emitTerminal(
      threadId,
      `Cost: ${costDisplay} | in: ${inTok} out: ${outTok}${savingsLine}`
    );
  }
  if (realCost) {
    const n = parseFloat(realCost.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) active.turnCostUsd = n;
  } else if (result.estimated_cost) {
    const n = parseFloat(String(result.estimated_cost).replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) active.turnCostUsd = n;
  }

  // Parse <thinking>...</thinking> blocks from the model's text response.
  // Some models (e.g. extended thinking, DeepSeek-R1 style) embed their chain-of-thought
  // inside explicit XML tags in the message text.
  // If thinking was already streamed in real-time via [stream] thinking_delta events,
  // skip the post-hoc emission to avoid duplicate content.
  if (!active.streamedThinking) {
    const thinkRegex = /<thinking>([\s\S]*?)<\/thinking>/gi;
    const thinkMatches = [...(result.message ?? "").matchAll(thinkRegex)];
    if (thinkMatches.length > 0) {
      const thinkingContent = thinkMatches.map((m) => m[1].trim()).join("\n\n");
      if (thinkingContent && !active.stopped) {
        streamService.publish(threadId, {
          type: "thinking_content",
          messageId,
          content: thinkingContent,
        });
      }
    }
  }
  // Strip <thinking> blocks from the visible message text
  const thinkRegex = /<thinking>([\s\S]*?)<\/thinking>/gi;
  const cleanMessage = (result.message ?? "").replace(thinkRegex, "").trim();

  // If text was already streamed in real-time via [stream] text_delta events,
  // we still need to update the server-side message store with the full final text
  // (to ensure messageService has the canonical version), but we do NOT re-emit
  // delta SSE events — the client already has the text.
  if (active.streamedText) {
    // The message service already has the incremental deltas appended in
    // parseStreamEvent. finalizeAssistant will be called after processSuccess
    // returns. No need to stream words again.
  } else {
    await streamWords(threadId, messageId, cleanMessage, () => active.stopped, streamingEnabled);
  }
}

/**
 * Best-effort map from model identifier → advertised context window (in
 * tokens). Falls back to 128K for unknown models. Used together with the
 * user-configurable `autoCompactThreshold` (a percentage) to decide when
 * to proactively summarize a conversation before the next turn fails.
 */
// ── Dynamic model metadata via OpenRouter ─────────────────────────────
//
// Fetches https://openrouter.ai/api/v1/models once, caches for 1 hour.
// Provides context window sizes AND pricing per model so compact
// thresholds are accurate and cost estimates use real rates instead of
// hardcoded Anthropic pricing.

type ModelMeta = {
  contextLength: number;
  inputCostPerToken: number;  // USD per token
  outputCostPerToken: number; // USD per token
};

let openRouterModelsCache: {
  fetchedAt: number;
  map: Map<string, ModelMeta>;
} | null = null;

const CTX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function loadOpenRouterModels(): Promise<Map<string, ModelMeta>> {
  if (openRouterModelsCache && Date.now() - openRouterModelsCache.fetchedAt < CTX_CACHE_TTL_MS) {
    return openRouterModelsCache.map;
  }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    if (!res.ok) throw new Error(`OpenRouter models ${res.status}`);
    const json = (await res.json()) as {
      data?: Array<{
        id?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    const map = new Map<string, ModelMeta>();
    for (const m of json.data ?? []) {
      if (!m.id) continue;
      const contextLength = typeof m.context_length === "number" && m.context_length > 0
        ? m.context_length
        : 128_000;
      const inputCostPerToken = parseFloat(m.pricing?.prompt ?? "0") || 0;
      const outputCostPerToken = parseFloat(m.pricing?.completion ?? "0") || 0;
      map.set(m.id, { contextLength, inputCostPerToken, outputCostPerToken });
    }
    openRouterModelsCache = { fetchedAt: Date.now(), map };
    logger.info({ models: map.size }, "Loaded OpenRouter model metadata");
    return map;
  } catch (err) {
    logger.warn({ err }, "Failed to fetch OpenRouter models — using cached/fallback");
    return openRouterModelsCache?.map ?? new Map();
  }
}

// Eagerly populate the cache on backend startup.
loadOpenRouterModels().catch(() => {});

function lookupModelMeta(modelName?: string): ModelMeta | null {
  if (!modelName || !openRouterModelsCache?.map) return null;
  const direct = openRouterModelsCache.map.get(modelName);
  if (direct) return direct;
  for (const [id, meta] of openRouterModelsCache.map) {
    if (id.endsWith(`/${modelName}`)) return meta;
  }
  return null;
}

function calculateRealCost(
  modelName: string | undefined,
  inputTokens: number,
  outputTokens: number,
): string | null {
  const meta = lookupModelMeta(modelName);
  if (!meta || (meta.inputCostPerToken === 0 && meta.outputCostPerToken === 0)) return null;
  const cost = inputTokens * meta.inputCostPerToken + outputTokens * meta.outputCostPerToken;
  return `$${cost.toFixed(4)}`;
}

// Anthropic direct pricing (per token, from https://docs.anthropic.com/en/docs/about-claude/pricing)
const ANTHROPIC_PRICING = {
  "opus": { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  "sonnet": { input: 3 / 1_000_000, output: 15 / 1_000_000 },
} as const;

function isAnthropicModel(modelName?: string): boolean {
  if (!modelName) return false;
  const m = modelName.toLowerCase();
  return (
    m.includes("claude") || m.includes("opus") ||
    m.includes("sonnet") || m.includes("haiku")
  );
}

function buildSavingsLine(
  modelName: string | undefined,
  inputTokens: number,
  outputTokens: number,
): string {
  if (!modelName || isAnthropicModel(modelName)) return "";
  const userMeta = lookupModelMeta(modelName);
  if (!userMeta) return "";
  const userCost =
    inputTokens * userMeta.inputCostPerToken +
    outputTokens * userMeta.outputCostPerToken;
  if (userCost <= 0) return "";

  const opusCost =
    inputTokens * ANTHROPIC_PRICING.opus.input +
    outputTokens * ANTHROPIC_PRICING.opus.output;
  const sonnetCost =
    inputTokens * ANTHROPIC_PRICING.sonnet.input +
    outputTokens * ANTHROPIC_PRICING.sonnet.output;
  const opusSaved = opusCost - userCost;
  const sonnetSaved = sonnetCost - userCost;
  if (opusSaved <= 0) return "";

  const parts = [`Saved $${opusSaved.toFixed(4)} vs Opus 4.6`];
  if (sonnetSaved > 0) {
    parts.push(`$${sonnetSaved.toFixed(4)} vs Sonnet 4.6`);
  }
  return `\n${parts.join(" | ")}`;
}

function getModelContextWindow(modelName?: string): number {
  if (!modelName) return 128_000;
  return lookupModelMeta(modelName)?.contextLength ?? 128_000;
}

async function getModelContextWindowAsync(modelName?: string): Promise<number> {
  if (!modelName) return 128_000;
  await loadOpenRouterModels();
  return lookupModelMeta(modelName)?.contextLength ?? 128_000;
}

/**
 * Scan the claw session directory and return the largest `input_tokens`
 * value reported by the most recent assistant turn. Returns 0 when no
 * session file exists yet (fresh thread) or when no usage info has been
 * written yet.
 *
 * The session jsonl is the authoritative record of the conversation claw
 * sends to the model, so the `usage` field it persists is the ground
 * truth for "how many tokens did the model see on the last turn".
 */
function readLastInputTokens(sessionDir: string): number {
  try {
    const sessionsRoot = path.join(sessionDir, "sessions");
    if (!fs.existsSync(sessionsRoot)) return 0;
    // Find the newest .jsonl under any subdir (claw groups sessions by a hash).
    let newestFile: string | null = null;
    let newestMtime = 0;
    for (const sub of fs.readdirSync(sessionsRoot)) {
      const subPath = path.join(sessionsRoot, sub);
      const stat = fs.statSync(subPath);
      if (!stat.isDirectory()) continue;
      for (const entry of fs.readdirSync(subPath)) {
        if (!entry.endsWith(".jsonl")) continue;
        const entryPath = path.join(subPath, entry);
        const entryStat = fs.statSync(entryPath);
        if (entryStat.mtimeMs > newestMtime) {
          newestMtime = entryStat.mtimeMs;
          newestFile = entryPath;
        }
      }
    }
    if (!newestFile) return 0;
    // Walk backwards through lines looking for the last assistant message
    // with a usage.input_tokens field. The jsonl is small (a few MB at most)
    // so reading it whole is fine.
    const content = fs.readFileSync(newestFile, "utf8");
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const message = parsed["message"] as Record<string, unknown> | undefined;
        if (!message || message["role"] !== "assistant") continue;
        const usage = message["usage"] as Record<string, unknown> | undefined;
        if (!usage) continue;
        const tokens = usage["input_tokens"];
        if (typeof tokens === "number" && tokens > 0) return tokens;
      } catch { /* skip malformed lines */ }
    }
  } catch (err) {
    logger.warn({ err, sessionDir }, "readLastInputTokens failed");
  }
  return 0;
}

/**
 * Rough per-category byte accounting of the most recent claw session file.
 * Used after each run to log what's consuming the context window — if one
 * tool result accounts for 60% of the prompt, that's worth knowing.
 *
 * Tokens are not directly counted (would require a tokenizer per model);
 * bytes are a reasonable proxy for relative size within JSON-encoded
 * English text (~3-4 bytes per token).
 */
function analyzeSessionBreakdown(sessionDir: string): {
  totalBytes: number;
  lineCount: number;
  byCategory: Record<string, { bytes: number; count: number }>;
  topEntries: Array<{ line: number; category: string; bytes: number; preview: string }>;
} | null {
  try {
    const sessionsRoot = path.join(sessionDir, "sessions");
    if (!fs.existsSync(sessionsRoot)) return null;
    let newestFile: string | null = null;
    let newestMtime = 0;
    for (const sub of fs.readdirSync(sessionsRoot)) {
      const subPath = path.join(sessionsRoot, sub);
      if (!fs.statSync(subPath).isDirectory()) continue;
      for (const entry of fs.readdirSync(subPath)) {
        if (!entry.endsWith(".jsonl")) continue;
        const entryPath = path.join(subPath, entry);
        const stat = fs.statSync(entryPath);
        if (stat.mtimeMs > newestMtime) {
          newestMtime = stat.mtimeMs;
          newestFile = entryPath;
        }
      }
    }
    if (!newestFile) return null;

    const content = fs.readFileSync(newestFile, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    const byCategory: Record<string, { bytes: number; count: number }> = {};
    const topEntries: Array<{ line: number; category: string; bytes: number; preview: string }> = [];
    let totalBytes = 0;

    lines.forEach((line, idx) => {
      totalBytes += line.length;
      const category = categorizeSessionLine(line);
      byCategory[category] ??= { bytes: 0, count: 0 };
      byCategory[category].bytes += line.length;
      byCategory[category].count += 1;
      topEntries.push({
        line: idx + 1,
        category,
        bytes: line.length,
        preview: line.slice(0, 120),
      });
    });

    topEntries.sort((a, b) => b.bytes - a.bytes);
    return {
      totalBytes,
      lineCount: lines.length,
      byCategory,
      topEntries: topEntries.slice(0, 8),
    };
  } catch (err) {
    logger.warn({ err, sessionDir }, "analyzeSessionBreakdown failed");
    return null;
  }
}

function categorizeSessionLine(line: string): string {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed["type"] === "session_meta") return "session_meta";
    const msg = parsed["message"] as Record<string, unknown> | undefined;
    if (!msg) return "other";
    const role = msg["role"];
    const blocks = (msg["blocks"] ?? []) as Array<Record<string, unknown>>;
    // Pick the dominant block type for this message.
    if (blocks.some((b) => b["type"] === "tool_result")) return "tool_result";
    if (blocks.some((b) => b["type"] === "tool_use")) return "assistant_tool_use";
    if (blocks.some((b) => b["type"] === "thinking")) return "assistant_thinking";
    if (role === "user") return "user_text";
    if (role === "assistant") return "assistant_text";
    return String(role ?? "other");
  } catch {
    return "parse_error";
  }
}

/**
 * Inspect the newest session file and decide whether the last assistant
 * turn ended cleanly or was truncated mid-sentence. This runs AFTER the
 * run's stream has closed — we only care about the final committed
 * state, not anything still streaming — so there's no risk of firing
 * during a live text delta burst.
 *
 * Heuristic: the turn is considered truncated only when the LAST block
 * of the most recent assistant message is a text block AND its trimmed
 * content ends with a "clearly mid-sentence" character (colon, comma,
 * em-dash, opening bracket/quote, etc.). Turns that end with a
 * tool_use, a period, a question mark, an exclamation, or a closing
 * paren/quote are considered complete.
 */
function detectTruncatedTail(sessionDir: string): {
  truncated: boolean;
  reason: string;
  tailPreview: string;
} {
  try {
    const sessionsRoot = path.join(sessionDir, "sessions");
    if (!fs.existsSync(sessionsRoot)) return { truncated: false, reason: "no-session-root", tailPreview: "" };
    let newestFile: string | null = null;
    let newestMtime = 0;
    for (const sub of fs.readdirSync(sessionsRoot)) {
      const subPath = path.join(sessionsRoot, sub);
      if (!fs.statSync(subPath).isDirectory()) continue;
      for (const entry of fs.readdirSync(subPath)) {
        if (!entry.endsWith(".jsonl")) continue;
        const entryPath = path.join(subPath, entry);
        const stat = fs.statSync(entryPath);
        if (stat.mtimeMs > newestMtime) {
          newestMtime = stat.mtimeMs;
          newestFile = entryPath;
        }
      }
    }
    if (!newestFile) return { truncated: false, reason: "no-session-file", tailPreview: "" };

    const content = fs.readFileSync(newestFile, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    // Walk backward to the most recent assistant message.
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]) as Record<string, unknown>;
        const msg = parsed["message"] as Record<string, unknown> | undefined;
        if (!msg || msg["role"] !== "assistant") continue;
        const blocks = (msg["blocks"] ?? []) as Array<Record<string, unknown>>;
        if (blocks.length === 0) {
          return { truncated: true, reason: "empty-blocks", tailPreview: "" };
        }
        const last = blocks[blocks.length - 1];
        if (last["type"] === "tool_use") {
          return { truncated: false, reason: "ended-in-tool_use", tailPreview: "" };
        }
        if (last["type"] !== "text") {
          return { truncated: false, reason: `last-block-is-${String(last["type"])}`, tailPreview: "" };
        }
        const text = ((last["text"] as string) ?? "").trim();
        if (!text) return { truncated: true, reason: "empty-text", tailPreview: "" };
        const lastChar = text[text.length - 1];
        const MID_SENTENCE = new Set([":", ",", ";", "—", "-", "(", "[", "{", "\"", "'", "`"]);
        if (MID_SENTENCE.has(lastChar)) {
          return {
            truncated: true,
            reason: `ends-with-"${lastChar}"`,
            tailPreview: text.slice(-80),
          };
        }
        return { truncated: false, reason: "clean-terminator", tailPreview: text.slice(-40) };
      } catch {
        // skip malformed line
      }
    }
    return { truncated: false, reason: "no-assistant", tailPreview: "" };
  } catch (err) {
    logger.warn({ err, sessionDir }, "detectTruncatedTail failed");
    return { truncated: false, reason: "error", tailPreview: "" };
  }
}

/** User-readable error-text heuristic: "the model gave up with an empty stream". */
function isEmptyResponse(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("stream produced no content") ||
    lower.includes("assistant stream produced no content") ||
    lower.includes("empty response") ||
    lower.includes("no content")
  );
}

export const clawRuntime = {
  async sendMessage(
    threadId: string,
    content: string,
    messageId: string,
    models: ModelConfig[],
    autoCompact = true,
    streamingEnabled = true,
    autoCompactThreshold = 70,
    autoContinueEnabled = true,
    attachments: Attachment[] = []
  ): Promise<string> {
    const thread = threadService.get(threadId);
    if (!thread) return "";

    const primaryBinary = getBinary(models[0]);
    if (!fs.existsSync(primaryBinary)) {
      const errMsg = primaryBinary === CLAUDE_CLI
        ? "Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code"
        : "claw binary not found. Run `bash scripts/build-claw.sh` first.";
      logger.error(errMsg);
      // Persist immediately so a re-fetch (e.g. re-entering the thread) shows
      // the error even if the live SSE stream missed the events.
      messageService.ensureAssistantMessage(threadId, messageId);
      messageService.appendAssistantDelta(threadId, messageId, errMsg);
      messageService.finalizeAssistant(threadId, messageId);
      threadService.setStatus(threadId, "idle");
      // Defer the SSE publish by one tick. The route handler returns 202
      // right before invoking this method, so the client's SSE subscriber
      // may still be completing its XHR connect when we would otherwise
      // publish synchronously — publish() silently drops events when the
      // subscriber set is empty, leaving the UI stuck on "thinking…" until
      // the user manually refreshes.
      setTimeout(() => {
        streamService.publish(threadId, { type: "delta", messageId, chunk: errMsg });
        streamService.publish(threadId, { type: "done", messageId });
        streamService.publish(threadId, { type: "status", status: "idle" });
        setRunPhase(threadId, "idle");
      }, 400);
      return "";
    }

    await this.stop(threadId);

    const run = runService.start(threadId);
    threadService.setStatus(threadId, "running");
    streamService.publish(threadId, { type: "status", status: "running" });
    // Do NOT eagerly create the assistant message here — appendAssistantDelta
    // creates it lazily on first content. This prevents empty ghost bubbles
    // when a run produces no output (e.g. compact-only cycle).

    const sessionDir = path.join(workspaceDir(threadId), ".claw");
    const cwd =
      thread.workDir && fs.existsSync(thread.workDir)
        ? thread.workDir
        : workspaceDir(threadId);

    // Decorate the user prompt so the agent learns about non-image
    // file attachments via plain text (it'll use Read/Grep/Glob to
    // open them); image attachments ride along as `--image` flags so
    // the model literally sees the pixels via its multimodal input.
    const decoratedPrompt = decoratePromptWithAttachments(content, attachments);

    const active: ActiveRun = {
      runId: run.id,
      child: null,
      stopped: false,
      realtimeStepIds: new Set(),
      streamedText: false,
      streamedThinking: "",
      currentMessageId: messageId,
      hadToolSinceLastText: false,
      allMessageIds: [messageId],
      startedAt: Date.now(),
      turnLog: [],
      turnToolSteps: [],
    };
    activeRuns.set(threadId, active);
    setRunPhase(threadId, "thinking");

    // Ensure at least one entry to try (no-model mode)
    const queue: Array<ModelConfig | undefined> = models.length > 0 ? models : [undefined];

    let finalSuccess = false;
    let compactAttempted = false; // only compact once per sendMessage call

    eventsService.record({
      source: "runtime",
      type: "run_start",
      threadId,
      runId: run.id,
      payload: {
        messageId,
        contentLength: content.length,
        contentPreview: content.slice(0, 200),
        modelQueue: queue.map((m) => ({ provider: m?.provider, name: m?.name })),
        autoCompact,
        autoCompactThreshold,
        streamingEnabled,
      },
    });

    // ── Proactive compaction ──────────────────────────────────────
    // Before spawning claw for this user message, check the last assistant
    // turn's reported input_tokens. If we're already above the user's
    // configured threshold (default 70% of the primary model's advertised
    // context window), compact now — waiting for the next turn to fail
    // would waste an API call and often produces a confusing empty-response
    // error rather than a clean overflow.
    if (autoCompact && !active.stopped) {
      const primary = queue[0];
      const contextSize = await getModelContextWindowAsync(primary?.name);
      const lastTokens = readLastInputTokens(sessionDir);
      const thresholdTokens = Math.floor((autoCompactThreshold / 100) * contextSize);
      eventsService.record({
        source: "runtime",
        type: "compact_threshold_check",
        threadId,
        runId: run.id,
        payload: {
          lastTokens,
          thresholdTokens,
          contextSize,
          thresholdPct: autoCompactThreshold,
          model: primary?.name,
          triggered: lastTokens > 0 && lastTokens >= thresholdTokens,
        },
      });
      if (lastTokens > 0 && lastTokens >= thresholdTokens) {
        logger.info(
          { threadId, lastTokens, thresholdTokens, contextSize, model: primary?.name },
          "proactive compact (threshold reached)"
        );
        eventsService.record({
          source: "runtime",
          type: "compact_start",
          threadId,
          runId: run.id,
          payload: {
            reason: "proactive_threshold",
            lastTokens,
            thresholdTokens,
            contextSize,
          },
        });
        compactAttempted = true;
        setRunPhase(threadId, "compacting");
        emitTerminal(
          threadId,
          `↻ Proactively compacting — last turn used ${lastTokens.toLocaleString()} tokens (≥ ${autoCompactThreshold}% of ${contextSize.toLocaleString()})`
        );
        streamService.publish(threadId, { type: "compact_start" });
        const bytesBefore = sessionBytes(sessionDir);
        const { succeeded: ok, stopped: cs, stdoutBuf: compactOut } = await spawnOnce(
          threadId, "", cwd, sessionDir, primary, active, true /* isCompact */
        );
        if (cs) {
          // run was stopped during compact — bail out cleanly
          activeRuns.delete(threadId);
          threadService.setStatus(threadId, "idle");
          streamService.publish(threadId, { type: "status", status: "idle" });
          setRunPhase(threadId, "idle");
          return "";
        }
        const info = ok
          ? parseCompactResult(compactOut)
          : { removedMessages: 0, keptMessages: 0 };
        const finalized = finalizeCompact(threadId, sessionDir, bytesBefore, ok, info);
        if (ok) {
          emitTerminal(
            threadId,
            `✓ Context compacted — removed ${info.removedMessages} messages, kept ${info.keptMessages} (~${finalized.approxTokensFreed.toLocaleString()} tokens freed)`
          );
        } else {
          emitTerminal(threadId, "⚠ Proactive compact failed — proceeding anyway");
        }
        streamService.publish(threadId, { type: "compact_end", ...finalized });
        eventsService.record({
          source: "runtime",
          type: "compact_end",
          threadId,
          runId: run.id,
          payload: { reason: "proactive_threshold", succeeded: ok, ...finalized },
        });
        setRunPhase(threadId, "thinking");
      }
    }

    for (let i = 0; i < queue.length; i++) {
      if (active.stopped) break;

      const model = queue[i];
      const label = model?.name ?? model?.provider ?? "default";

      if (i > 0) emitTerminal(threadId, `↻ Trying fallback: ${label}`);

      // Snapshot the session before each model attempt so we can roll
      // back if this model fails. Prevents session pollution where
      // each failed spawn leaves data that inflates token counts for
      // the next model in the queue.
      const sessionSnap = snapshotSession(sessionDir);

      const spawnStartTs = Date.now();
      eventsService.record({
        source: "runtime",
        type: "spawn_start",
        threadId,
        runId: run.id,
        payload: {
          attempt: i + 1,
          model: model?.name,
          provider: model?.provider,
          contentLength: content.length,
        },
      });

      const { succeeded, stdoutBuf, stderrBuf, stopped } = await spawnOnce(
        threadId, decoratedPrompt, cwd, sessionDir, model, active, false, messageId, attachments
      );

      // Capture whichever model was actually used on this attempt so the
      // finalize step can persist it as the turn's model of record.
      if (succeeded && model?.name) {
        active.turnModel = model.name;
      }

      // Read tokens from the session immediately after the spawn so we
      // can record them regardless of which branch we take below.
      const tokensAfter = readLastInputTokens(sessionDir);
      eventsService.record({
        source: "runtime",
        type: "spawn_end",
        threadId,
        runId: run.id,
        payload: {
          attempt: i + 1,
          model: model?.name,
          succeeded,
          stopped,
          durationMs: Date.now() - spawnStartTs,
          stdoutBytes: stdoutBuf.length,
          stderrBytes: stderrBuf.length,
          inputTokens: tokensAfter,
          contextSize: getModelContextWindow(model?.name),
          contextPct: tokensAfter > 0
            ? Math.round((tokensAfter / getModelContextWindow(model?.name)) * 100)
            : 0,
        },
      });

      if (stopped) break;

      // ── Success path ───────────────────────────────────────────
      if (succeeded) {
        try {
          setRunPhase(threadId, "responding");
          await processSuccess(threadId, messageId, stdoutBuf, active, streamingEnabled);
          finalSuccess = true;
        } catch (err: any) {
          if (err.isContextOverflow && autoCompact && !compactAttempted && !active.stopped) {
            compactAttempted = true;
            setRunPhase(threadId, "compacting");
            emitTerminal(threadId, "↻ Auto-compacting context…");
            streamService.publish(threadId, { type: "compact_start" });
            const bytesBefore = sessionBytes(sessionDir);
            const { succeeded: ok, stopped: cs, stdoutBuf: compactOut } = await spawnOnce(
              threadId, "", cwd, sessionDir, model, active, true /* isCompact */
            );
            if (cs) break;
            const info = ok
              ? parseCompactResult(compactOut)
              : { removedMessages: 0, keptMessages: 0 };
            const finalized = finalizeCompact(threadId, sessionDir, bytesBefore, ok, info);
            if (ok) {
              emitTerminal(
                threadId,
                `✓ Context compacted — removed ${info.removedMessages} messages, kept ${info.keptMessages} (~${finalized.approxTokensFreed.toLocaleString()} tokens freed)`
              );
              streamService.publish(threadId, { type: "compact_end", ...finalized });
              setRunPhase(threadId, "thinking");
              i--;
              continue;
            }
            streamService.publish(threadId, { type: "compact_end", ...finalized });
            setRunPhase(threadId, "thinking");
            emitTerminal(threadId, "⚠ Compact failed");
          }
          // Retry retryable errors (502, 429, rate limits) on the
          // same model with exponential backoff before surfacing.
          if ((err.isClawError || err.message) && isRetryableError(err.message ?? "")) {
            let retryOk = false;
            for (let r = 1; r <= MAX_RETRIES; r++) {
              if (active.stopped) break;
              const delayMs = RETRY_BASE_MS * Math.pow(2, r - 1);
              emitTerminal(
                threadId,
                `↻ Retryable error — waiting ${(delayMs / 1000).toFixed(0)}s then retrying ${label} (${r}/${MAX_RETRIES})`
              );
              await sleep(delayMs);
              if (active.stopped) break;
              setRunPhase(threadId, "thinking");
              const retry = await spawnOnce(
                threadId, decoratedPrompt, cwd, sessionDir, model, active, false, messageId, attachments
              );
              if (retry.stopped) break;
              if (retry.succeeded) {
                try {
                  setRunPhase(threadId, "responding");
                  await processSuccess(threadId, messageId, retry.stdoutBuf, active, streamingEnabled);
                  if (model?.name) active.turnModel = model.name;
                  finalSuccess = true;
                  retryOk = true;
                } catch (innerErr: any) {
                  // If the retry itself hits another retryable error, loop again
                  if (isRetryableError(innerErr.message ?? "")) continue;
                  // Non-retryable — surface it
                  const text2 = friendlyError(innerErr.message) || "An error occurred — please try again.";
                  const errMsgId2 = active.currentMessageId;
                  messageService.appendAssistantDelta(threadId, errMsgId2, text2);
                  messageService.markError(threadId, errMsgId2);
                  streamService.publish(threadId, { type: "message_error", messageId: errMsgId2, text: text2 });
                }
                break;
              }
              const retryErr = extractClawError(retry.stdoutBuf, retry.stderrBuf);
              if (!isRetryableError(retryErr)) break;
            }
            if (retryOk || active.stopped) break;
            // All retries exhausted — fall through to emit error
            emitTerminal(threadId, `⚠ ${label} failed after ${MAX_RETRIES} retries`);
          } else if (err.isClawError) {
            logger.warn({ model: label }, "claw exited ok but reported error");
            const text = friendlyError(err.message) || "An error occurred — please try again.";
            const errMsgId = active.currentMessageId;
            messageService.appendAssistantDelta(threadId, errMsgId, text);
            messageService.markError(threadId, errMsgId);
            streamService.publish(threadId, { type: "message_error", messageId: errMsgId, text });
          } else {
            logger.error({ err, stdoutBuf }, "Failed to parse claw JSON output");
            const text = friendlyError(err.message) || "An error occurred — please try again.";
            const errMsgId = active.currentMessageId;
            messageService.appendAssistantDelta(threadId, errMsgId, text);
            messageService.markError(threadId, errMsgId);
            streamService.publish(threadId, { type: "message_error", messageId: errMsgId, text });
          }
        }
        break;
      }

      // ── Failure path ───────────────────────────────────────────
      let errText = extractClawError(stdoutBuf, stderrBuf);
      logger.error({ stderrBuf: stderrBuf.slice(-200), model: label }, "claw attempt failed");

      eventsService.record({
        source: "runtime",
        type: "runtime_error",
        threadId,
        runId: run.id,
        payload: {
          attempt: i + 1,
          model: model?.name,
          errorPreview: errText.slice(0, 500),
          isOverflow: isContextOverflow(errText),
          isEmptyResponse: isEmptyResponse(errText),
          isRetryable: isRetryableError(errText),
        },
      });

      // ── Retry transient errors (502, 429, rate limits) on the
      //    SAME model with exponential backoff before falling through
      //    to the next model in the queue. This preserves context —
      //    switching models can lose the claw session state.
      if (isRetryableError(errText)) {
        let retrySucceeded = false;
        for (let r = 1; r <= MAX_RETRIES; r++) {
          if (active.stopped) break;
          const delayMs = RETRY_BASE_MS * Math.pow(2, r - 1); // 2s, 4s, 8s
          emitTerminal(
            threadId,
            `↻ Retryable error — waiting ${(delayMs / 1000).toFixed(0)}s then retrying ${label} (${r}/${MAX_RETRIES})`
          );
          await sleep(delayMs);
          if (active.stopped) break;
          setRunPhase(threadId, "thinking");
          const retry = await spawnOnce(
            threadId, decoratedPrompt, cwd, sessionDir, model, active, false, messageId, attachments
          );
          if (retry.stopped) break;
          if (retry.succeeded) {
            if (model?.name) active.turnModel = model.name;
            try {
              setRunPhase(threadId, "responding");
              await processSuccess(threadId, messageId, retry.stdoutBuf, active, streamingEnabled);
              finalSuccess = true;
              retrySucceeded = true;
            } catch (retryErr: any) {
              emitTerminal(threadId, `⚠ Retry ${r} succeeded but processSuccess failed: ${retryErr.message?.slice(0, 200)}`);
            }
            break;
          }
          errText = extractClawError(retry.stdoutBuf, retry.stderrBuf);
          if (!isRetryableError(errText)) {
            emitTerminal(threadId, `⚠ Retry ${r} failed with non-retryable error`);
            break;
          }
        }
        if (retrySucceeded) break;
        if (active.stopped) break;
        // All retries exhausted — fall through to compact / next model.
        // Restore the session first so the next model starts clean.
        restoreSession(sessionSnap);
        emitTerminal(threadId, `⚠ ${label} failed after ${MAX_RETRIES} retries`);
      }

      // Broaden the compact trigger: explicit overflow (Anthropic-style)
      // OR an empty-response failure. Some providers (notably GLM via
      // OpenRouter) return a silent empty stream instead of raising a
      // proper overflow error — and they do it well below the advertised
      // context window. We saw a failure at 110K tokens (55%) on a 200K
      // model, so we no longer gate the empty-response retry on the
      // user's compact threshold — any empty response with autoCompact
      // on gets one shot at compact+retry.
      const contextSize = await getModelContextWindowAsync(model?.name);
      const lastTokens = readLastInputTokens(sessionDir);
      const thresholdTokens = Math.floor((autoCompactThreshold / 100) * contextSize);
      const empty = isEmptyResponse(errText);
      const shouldCompact =
        (isContextOverflow(errText) || empty) &&
        autoCompact &&
        !compactAttempted &&
        !active.stopped;

      if (shouldCompact) {
        eventsService.record({
          source: "runtime",
          type: "compact_start",
          threadId,
          runId: run.id,
          payload: {
            reason: empty ? "empty_response" : "context_overflow",
            lastTokens,
            thresholdTokens,
            contextSize,
            model: model?.name,
          },
        });
        compactAttempted = true;
        setRunPhase(threadId, "compacting");
        if (empty) {
          emitTerminal(
            threadId,
            `↻ Empty response at ${lastTokens.toLocaleString()} tokens — auto-compacting and retrying`
          );
        } else {
          emitTerminal(threadId, "↻ Auto-compacting context…");
        }
        streamService.publish(threadId, { type: "compact_start" });
        const bytesBefore = sessionBytes(sessionDir);
        const { succeeded: ok, stopped: cs, stdoutBuf: compactOut } = await spawnOnce(
          threadId, "", cwd, sessionDir, model, active, true /* isCompact */
        );
        if (cs) break;
        const info = ok
          ? parseCompactResult(compactOut)
          : { removedMessages: 0, keptMessages: 0 };
        const finalized = finalizeCompact(threadId, sessionDir, bytesBefore, ok, info);
        if (ok) {
          emitTerminal(
            threadId,
            `✓ Context compacted — removed ${info.removedMessages} messages, kept ${info.keptMessages} (~${finalized.approxTokensFreed.toLocaleString()} tokens freed)`
          );
          streamService.publish(threadId, { type: "compact_end", ...finalized });
          setRunPhase(threadId, "thinking");
          i--;
          continue;
        }
        streamService.publish(threadId, { type: "compact_end", ...finalized });
        setRunPhase(threadId, "thinking");
        emitTerminal(threadId, "⚠ Compact failed — trying next model if available");
      }

      if (i < queue.length - 1) {
        // Roll back the session so the next model starts clean —
        // without this, each failed spawn's data would accumulate
        // and the next model would re-read (and pay for) all of it.
        restoreSession(sessionSnap);
        emitTerminal(threadId, `⚠ ${label} failed — trying next model`);
        continue;
      }

      const text = isContextOverflow(errText) ? formatContextOverflow() : friendlyError(errText);
      const safeText = text || "An error occurred — please try again.";
      const errMsgId = active.currentMessageId;
      messageService.appendAssistantDelta(threadId, errMsgId, safeText);
      messageService.markError(threadId, errMsgId);
      streamService.publish(threadId, { type: "message_error", messageId: errMsgId, text: safeText });
    }

    // ── Auto-continue on truncated tail ────────────────────────────
    // Some providers (notably GLM via OpenRouter) emit very short
    // responses that end mid-sentence and then voluntarily stop —
    // 14 output tokens ending in ":" is the canonical example we hit.
    // When the run has otherwise succeeded AND the last assistant text
    // block ends with clearly mid-sentence punctuation, we fire ONE
    // synthetic "continue" spawn so the model can finish its thought.
    // This only runs once per sendMessage call. Gated by the
    // `autoContinueEnabled` setting so users can turn it off.
    let autoContinueFired = false;
    if (
      finalSuccess &&
      autoContinueEnabled &&
      !active.stopped &&
      models.length > 0
    ) {
      const tail = detectTruncatedTail(sessionDir);
      if (tail.truncated) {
        autoContinueFired = true;
        eventsService.record({
          source: "runtime",
          type: "auto_continue",
          threadId,
          runId: run.id,
          payload: { reason: tail.reason, tailPreview: tail.tailPreview },
        });
        emitTerminal(
          threadId,
          `↻ Turn ended mid-sentence (${tail.reason}) — auto-continuing`
        );
        setRunPhase(threadId, "thinking");
        streamService.publish(threadId, { type: "status", status: "running" });
        const primary = queue[0];
        try {
          const {
            succeeded: contOk,
            stdoutBuf: contStdout,
            stopped: contStopped,
          } = await spawnOnce(
            threadId,
            "continue",
            cwd,
            sessionDir,
            primary,
            active,
            false,
            active.currentMessageId
          );
          if (!contStopped && contOk) {
            try {
              await processSuccess(
                threadId,
                active.currentMessageId,
                contStdout,
                active,
                streamingEnabled
              );
            } catch (err) {
              logger.warn({ err }, "auto-continue processSuccess failed");
            }
          }
        } catch (err) {
          logger.warn({ err }, "auto-continue spawn failed");
        }
      }
    }

    activeRuns.delete(threadId);
    setRunPhase(threadId, "idle");

    if (active.stopped) {
      runService.markStatus(run.id, "stopped");
      return run.id;
    }

    // Finalize every bubble created during this run (initial + any new-turn bubbles).
    for (const mid of active.allMessageIds) {
      messageService.finalizeAssistant(threadId, mid);
    }

    // Persist per-turn telemetry on the last surviving assistant bubble.
    // Walk backwards through allMessageIds and pick the first one that
    // still exists (finalizeAssistant deletes empty bubbles). Tokens,
    // cost, model, duration go into real columns; thinking, turn log,
    // and tool steps go into the metadata JSON blob.
    let telemetryTarget: string | null = null;
    for (let i = active.allMessageIds.length - 1; i >= 0; i--) {
      if (messageService.get(active.allMessageIds[i])) {
        telemetryTarget = active.allMessageIds[i];
        break;
      }
    }
    if (telemetryTarget && finalSuccess) {
      const durationMs = Date.now() - active.startedAt;
      messageService.setTurnTelemetry(telemetryTarget, {
        model: active.turnModel,
        tokensIn: active.turnTokensIn,
        tokensOut: active.turnTokensOut,
        costUsd: active.turnCostUsd,
        turnDurationMs: durationMs,
        metadata: {
          thinking: active.streamedThinking || undefined,
          turnLog: active.turnLog.length > 0 ? active.turnLog : undefined,
          toolSteps:
            active.turnToolSteps.length > 0 ? active.turnToolSteps : undefined,
        },
      });
    }

    // Signal done on the last active bubble so the client clears its run state.
    streamService.publish(threadId, { type: "done", messageId: active.currentMessageId });

    if (finalSuccess) {
      threadService.setStatus(threadId, "idle");
      runService.markStatus(run.id, "done");
      streamService.publish(threadId, { type: "status", status: "idle" });
    } else {
      threadService.setStatus(threadId, "error");
      runService.markStatus(run.id, "error");
      streamService.publish(threadId, { type: "status", status: "error" });
    }

    // Final diagnostics for the run: token breakdown by session line
    // category, final tokens, which bubbles got created, and overall status.
    const breakdown = analyzeSessionBreakdown(sessionDir);
    const finalTokens = readLastInputTokens(sessionDir);
    eventsService.record({
      source: "runtime",
      type: "run_end",
      threadId,
      runId: run.id,
      payload: {
        succeeded: finalSuccess,
        stopped: active.stopped,
        finalInputTokens: finalTokens,
        bubbleIds: active.allMessageIds,
        sessionBreakdown: breakdown,
      },
    });

    return run.id;
  },

  async stop(threadId: string) {
    const active = activeRuns.get(threadId);
    if (!active) {
      threadService.setStatus(threadId, "idle");
      setRunPhase(threadId, "idle");
      return;
    }
    active.stopped = true;
    if (active.child && !active.child.killed) {
      active.child.kill("SIGTERM");
      setTimeout(() => {
        if (active.child && !active.child.killed) active.child.kill("SIGKILL");
      }, 2000);
    }
    activeRuns.delete(threadId);
    setRunPhase(threadId, "idle");
    runService.markStatus(active.runId, "stopped");
    threadService.setStatus(threadId, "idle");
    streamService.publish(threadId, { type: "status", status: "idle" });
    logger.info({ threadId }, "Stopped claw run");
  },

  async getTerminalLines(threadId: string) {
    return terminalService.getHistory(threadId);
  },

  workspaceDir,
};
