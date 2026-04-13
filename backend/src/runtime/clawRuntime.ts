import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger";
import { messageService } from "../services/messageService";
import { streamService } from "../services/streamService";
import { threadService } from "../services/threadService";
import { terminalService } from "../services/terminalService";
import { runService } from "../services/runService";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CLAW_BINARY = path.resolve(
  __dirname,
  "../../../claw-code/rust/target/debug/claw"
);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const WORKSPACES_DIR = path.resolve(__dirname, "../../data/workspaces");

fs.mkdirSync(WORKSPACES_DIR, { recursive: true });

export type ModelConfig = {
  provider: "claude" | "openrouter" | "local";
  name?: string;
  apiKey?: string;
};

type ActiveRun = {
  runId: string;
  child: ReturnType<typeof spawn> | null;
  stopped: boolean;
};

type SpawnResult = {
  succeeded: boolean;
  stdoutBuf: string;
  stderrBuf: string;
  stopped: boolean;
};

const activeRuns = new Map<string, ActiveRun>();

function workspaceDir(threadId: string): string {
  const dir = path.join(WORKSPACES_DIR, threadId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function buildEnv(
  model?: ModelConfig,
  sessionDir?: string
): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;

  if (model?.apiKey) {
    if (model.provider === "openrouter") {
      env["OPENAI_API_KEY"] = model.apiKey;
      env["OPENAI_BASE_URL"] = "https://openrouter.ai/api/v1";
      delete env["ANTHROPIC_API_KEY"];
      delete env["ANTHROPIC_AUTH_TOKEN"];
    } else {
      env["ANTHROPIC_API_KEY"] = model.apiKey;
      delete env["OPENAI_API_KEY"];
      delete env["OPENAI_BASE_URL"];
    }
  }

  if (model?.name) {
    env["CLAW_MODEL"] = model.name;
  }

  if (sessionDir) {
    env["CLAW_SESSION_DIR"] = sessionDir;
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  return env;
}

function buildArgs(prompt: string, model?: ModelConfig): string[] {
  const args: string[] = ["--output-format", "json"];
  if (model?.name) args.push("--model", model.name);
  args.push("--permission-mode", "danger-full-access");
  args.push("prompt", prompt);
  return args;
}

/**
 * Args for a compact run.
 * Uses `--resume <session-file> /compact`, NOT the `prompt` subcommand.
 * We resolve the actual session .jsonl path so that CLAW_SESSION_DIR is
 * honoured — `--resume latest` resolves from the default sessions dir,
 * which ignores our per-thread CLAW_SESSION_DIR override.
 */
function buildCompactArgs(model?: ModelConfig, sessionDir?: string): string[] {
  const args: string[] = [];
  if (model?.name) args.push("--model", model.name);

  // Resolve the most recently modified .jsonl file in our per-thread session dir.
  // Claw uses a legacy layout: <sessionDir>/<hash>/session-*.jsonl (1 level deep)
  // so we scan both the top level AND one level of subdirectories.
  let sessionArg = "latest"; // safe fallback — claw resolves from CWD
  if (sessionDir && fs.existsSync(sessionDir)) {
    try {
      const candidates: { file: string; mtime: number }[] = [];
      const addIfJsonl = (p: string) => {
        if (p.endsWith(".jsonl") || p.endsWith(".json")) {
          try { candidates.push({ file: p, mtime: fs.statSync(p).mtimeMs }); } catch { /* skip */ }
        }
      };
      for (const entry of fs.readdirSync(sessionDir)) {
        const full = path.join(sessionDir, entry);
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            for (const sub of fs.readdirSync(full)) addIfJsonl(path.join(full, sub));
          } else {
            addIfJsonl(full);
          }
        } catch { /* skip */ }
      }
      candidates.sort((a, b) => b.mtime - a.mtime);
      if (candidates.length > 0) sessionArg = candidates[0].file;
    } catch {
      // ignore — fall back to "latest"
    }
  }

  args.push("--resume", sessionArg, "/compact");
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
  isCompact = false
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const args = isCompact ? buildCompactArgs(model, sessionDir) : buildArgs(content, model);
    const env = buildEnv(model, sessionDir);
    logger.info({ threadId, cwd, model: model?.name ?? model?.provider, args }, "Spawning claw");

    const child = spawn(CLAW_BINARY, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    active.child = child;

    let stdoutBuf = "";
    let stderrBuf = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuf += text;
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) emitTerminal(threadId, trimmed);
      }
    });

    child.on("close", (code) => {
      if (active.stopped) {
        resolve({ succeeded: false, stdoutBuf, stderrBuf, stopped: true });
        return;
      }
      resolve({ succeeded: code === 0, stdoutBuf, stderrBuf, stopped: false });
    });

    child.on("error", (err) => {
      logger.error({ err }, "Failed to spawn claw");
      resolve({ succeeded: false, stdoutBuf, stderrBuf: err.message, stopped: false });
    });
  });
}

/**
 * Extract a clean error message from claw's stdout/stderr.
 * Claw sometimes writes structured JSON to stderr or stdout on error exit.
 * Also detects context-window overflow and returns a user-friendly message.
 */
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
    text.includes("/compact") ||
    text.includes("Compact") ||
    (lower.includes("context") && lower.includes("compact")) ||
    lower.includes("context window full") ||
    lower.includes("context length")
  );
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
  if (lower.includes("context length") || lower.includes("context window")) {
    return formatContextOverflow();
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "The request timed out. Please try again.";
  }
  // Pass through short plain-text messages; truncate long ones
  if (raw.length <= 200) return raw;
  return raw.slice(0, 200) + "…";
}

/** Derive a human-readable label from a tool_use input object. */
function toolLabel(toolName: string, input: unknown): string {
  const inp = input as Record<string, unknown>;
  switch (toolName) {
    case "bash":
      return (inp["command"] as string ?? "").slice(0, 80);
    case "read":
    case "cat":
      return (inp["file_path"] as string ?? inp["path"] as string ?? "").slice(0, 80);
    case "edit":
    case "write":
    case "write_file":
    case "str_replace_editor":
      return (inp["file_path"] as string ?? inp["path"] as string ?? "").slice(0, 80);
    case "grep":
    case "search":
      return (inp["pattern"] as string ?? inp["query"] as string ?? "").slice(0, 80);
    case "glob":
      return (inp["pattern"] as string ?? "").slice(0, 80);
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
  const result = JSON.parse(stdoutBuf.trim()) as {
    type?: string;
    message: string;
    // Claw emits { id, name, input } — note: "name", NOT "tool_name"
    tool_uses?: Array<{ id?: string; name: string; input: unknown }>;
    tool_results?: Array<{ content: string }>;
    usage?: { input_tokens: number; output_tokens: number };
    estimated_cost?: string;
  };

  // Claw may exit 0 but output an error JSON — treat it as a failure
  if (result.type === "error") {
    const msg = result.message ?? "claw reported an error";
    const overflow = isContextOverflow(msg);
    throw Object.assign(new Error(overflow ? formatContextOverflow() : msg.split("\n")[0].trim() || msg), {
      isClawError: true,
      isContextOverflow: overflow,
    });
  }

  // Stagger tool_start / tool_end events so the UI can display each badge
  // appearing one-by-one before the response message streams in.
  // Each tool gets a brief "running" window (spinner visible) before done.
  const toolUses = result.tool_uses ?? [];
  for (const tu of toolUses) {
    if (active.stopped) break;
    const toolName = tu.name ?? "unknown";
    const stepId = `step-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const label = toolLabel(toolName, tu.input) || toolName;
    streamService.publish(threadId, {
      type: "tool_start",
      id: stepId,
      messageId,
      tool: toolName,
      label,
    });
    // Brief pause so the badge renders as "running" before flipping to done
    await sleep(90);
    streamService.publish(threadId, {
      type: "tool_end",
      id: stepId,
      messageId,
    });
    // Also emit to terminal for the debug view
    emitTerminal(threadId, `[${toolName}] ${JSON.stringify(tu.input).slice(0, 200)}`);
    // Short gap between steps for a natural appearance
    await sleep(55);
  }
  // Pause briefly so user can see all steps before the text begins streaming
  if (toolUses.length > 0 && !active.stopped) {
    await sleep(220);
  }
  for (const tr of result.tool_results ?? []) {
    if (tr.content) emitTerminal(threadId, tr.content.slice(0, 400));
  }
  if (result.estimated_cost) {
    emitTerminal(
      threadId,
      `Cost: ${result.estimated_cost} | in: ${result.usage?.input_tokens ?? 0} out: ${result.usage?.output_tokens ?? 0}`
    );
  }

  // Parse <thinking>...</thinking> blocks from the model's text response.
  // Some models (e.g. extended thinking, DeepSeek-R1 style) embed their chain-of-thought
  // inside explicit XML tags in the message text.
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
  // Strip <thinking> blocks from the visible message text
  const cleanMessage = (result.message ?? "").replace(thinkRegex, "").trim();

  await streamWords(threadId, messageId, cleanMessage, () => active.stopped, streamingEnabled);
}

export const clawRuntime = {
  async sendMessage(
    threadId: string,
    content: string,
    messageId: string,
    models: ModelConfig[],
    autoCompact = true,
    streamingEnabled = true
  ): Promise<string> {
    const thread = threadService.get(threadId);
    if (!thread) return "";

    if (!fs.existsSync(CLAW_BINARY)) {
      const errMsg = "claw binary not found. Run `bash scripts/build-claw.sh` first.";
      logger.error(errMsg);
      messageService.ensureAssistantMessage(threadId, messageId);
      messageService.appendAssistantDelta(threadId, messageId, errMsg);
      messageService.finalizeAssistant(threadId, messageId);
      streamService.publish(threadId, { type: "delta", messageId, chunk: errMsg });
      streamService.publish(threadId, { type: "done", messageId });
      threadService.setStatus(threadId, "idle");
      streamService.publish(threadId, { type: "status", status: "idle" });
      return "";
    }

    await this.stop(threadId);

    const run = runService.start(threadId);
    threadService.setStatus(threadId, "running");
    streamService.publish(threadId, { type: "status", status: "running" });
    // Do NOT eagerly create the assistant message here — appendAssistantDelta
    // creates it lazily on first content. This prevents empty ghost bubbles
    // when a run produces no output (e.g. compact-only cycle).

    const sessionDir = path.join(workspaceDir(threadId), ".claw", "sessions");
    const cwd =
      thread.workDir && fs.existsSync(thread.workDir)
        ? thread.workDir
        : workspaceDir(threadId);

    const active: ActiveRun = { runId: run.id, child: null, stopped: false };
    activeRuns.set(threadId, active);

    // Ensure at least one entry to try (no-model mode)
    const queue: Array<ModelConfig | undefined> = models.length > 0 ? models : [undefined];

    let finalSuccess = false;
    let compactAttempted = false; // only compact once per sendMessage call

    for (let i = 0; i < queue.length; i++) {
      if (active.stopped) break;

      const model = queue[i];
      const label = model?.name ?? model?.provider ?? "default";

      if (i > 0) emitTerminal(threadId, `↻ Trying fallback: ${label}`);

      const { succeeded, stdoutBuf, stderrBuf, stopped } = await spawnOnce(
        threadId, content, cwd, sessionDir, model, active
      );

      if (stopped) break;

      // ── Success path ───────────────────────────────────────────
      if (succeeded) {
        try {
          await processSuccess(threadId, messageId, stdoutBuf, active, streamingEnabled);
          finalSuccess = true;
        } catch (err: any) {
          if (err.isContextOverflow && autoCompact && !compactAttempted && !active.stopped) {
            // Compact and retry this same model
            compactAttempted = true;
            emitTerminal(threadId, "↻ Auto-compacting context…");
            const { succeeded: ok, stopped: cs } = await spawnOnce(
              threadId, "", cwd, sessionDir, model, active, true /* isCompact */
            );
            if (!cs && ok) {
              emitTerminal(threadId, "✓ Context compacted — retrying your message");
              i--; // retry same model on next iteration
              continue;
            }
            if (cs) break;
            emitTerminal(threadId, "⚠ Compact failed");
          }
          if (err.isClawError) {
            logger.warn({ model: label }, "claw exited ok but reported error");
            const text = friendlyError(err.message);
            messageService.appendAssistantDelta(threadId, messageId, text);
            streamService.publish(threadId, { type: "message_error", messageId, text });
          } else {
            logger.error({ err, stdoutBuf }, "Failed to parse claw JSON output");
            const text = friendlyError(err.message);
            messageService.appendAssistantDelta(threadId, messageId, text);
            streamService.publish(threadId, { type: "message_error", messageId, text });
          }
        }
        break;
      }

      // ── Failure path ───────────────────────────────────────────
      const errText = extractClawError(stdoutBuf, stderrBuf);
      logger.error({ stderrBuf: stderrBuf.slice(-200), model: label }, "claw attempt failed");

      // Auto-compact on context overflow (non-zero exit)
      if (isContextOverflow(errText) && autoCompact && !compactAttempted && !active.stopped) {
        compactAttempted = true;
        emitTerminal(threadId, "↻ Auto-compacting context…");
        const { succeeded: ok, stopped: cs } = await spawnOnce(
          threadId, "", cwd, sessionDir, model, active, true /* isCompact */
        );
        if (cs) break;
        if (ok) {
          emitTerminal(threadId, "✓ Context compacted — retrying your message");
          i--; // retry same model on next iteration
          continue;
        }
        emitTerminal(threadId, "⚠ Compact failed — trying next model if available");
      }

      if (i < queue.length - 1) {
        emitTerminal(threadId, `⚠ ${label} failed — trying next model`);
        continue;
      }

      // Last model exhausted — surface error in message bubble
      const text = isContextOverflow(errText) ? formatContextOverflow() : friendlyError(errText);
      messageService.appendAssistantDelta(threadId, messageId, text);
      streamService.publish(threadId, { type: "message_error", messageId, text });
    }

    activeRuns.delete(threadId);

    if (active.stopped) {
      runService.markStatus(run.id, "stopped");
      return run.id;
    }

    messageService.finalizeAssistant(threadId, messageId);
    streamService.publish(threadId, { type: "done", messageId });

    if (finalSuccess) {
      threadService.setStatus(threadId, "idle");
      runService.markStatus(run.id, "done");
      streamService.publish(threadId, { type: "status", status: "idle" });
    } else {
      threadService.setStatus(threadId, "error");
      runService.markStatus(run.id, "error");
      streamService.publish(threadId, { type: "status", status: "error" });
    }

    return run.id;
  },

  async stop(threadId: string) {
    const active = activeRuns.get(threadId);
    if (!active) {
      threadService.setStatus(threadId, "idle");
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
