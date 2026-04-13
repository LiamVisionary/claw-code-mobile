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

/** Stream the text of a completed response word-by-word for a nicer UX. */
async function streamWords(
  threadId: string,
  messageId: string,
  text: string,
  stopped: () => boolean
): Promise<void> {
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
  active: ActiveRun
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const args = buildArgs(content, model);
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

/** Parse claw's JSON stdout and emit tool/cost lines + stream the message. */
async function processSuccess(
  threadId: string,
  messageId: string,
  stdoutBuf: string,
  active: ActiveRun
): Promise<void> {
  const result = JSON.parse(stdoutBuf.trim()) as {
    message: string;
    tool_uses?: Array<{ tool_name: string; input: unknown }>;
    tool_results?: Array<{ content: string }>;
    usage?: { input_tokens: number; output_tokens: number };
    estimated_cost?: string;
  };

  for (const tu of result.tool_uses ?? []) {
    emitTerminal(threadId, `[${tu.tool_name}] ${JSON.stringify(tu.input).slice(0, 200)}`);
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

  await streamWords(threadId, messageId, result.message ?? "", () => active.stopped);
}

export const clawRuntime = {
  async sendMessage(
    threadId: string,
    content: string,
    messageId: string,
    models: ModelConfig[]
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
    messageService.ensureAssistantMessage(threadId, messageId);

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

    for (let i = 0; i < queue.length; i++) {
      if (active.stopped) break;

      const model = queue[i];
      const label = model?.name ?? model?.provider ?? "default";

      if (i > 0) {
        emitTerminal(threadId, `↻ Trying fallback: ${label}`);
      }

      const { succeeded, stdoutBuf, stderrBuf, stopped } = await spawnOnce(
        threadId, content, cwd, sessionDir, model, active
      );

      if (stopped) break;

      if (succeeded) {
        try {
          await processSuccess(threadId, messageId, stdoutBuf, active);
          finalSuccess = true;
        } catch (err: any) {
          logger.error({ err, stdoutBuf }, "Failed to parse claw JSON output");
          const errChunk = `Parse error: ${err.message}\nstdout: ${stdoutBuf.slice(0, 200)}`;
          messageService.appendAssistantDelta(threadId, messageId, errChunk);
          streamService.publish(threadId, { type: "delta", messageId, chunk: errChunk });
        }
        break;
      }

      // Failed — log and decide whether to retry
      const errText = stderrBuf.slice(-300) || `claw exited with error`;
      logger.error({ errText, model: label }, "claw attempt failed");

      if (i < queue.length - 1) {
        emitTerminal(threadId, `⚠ ${label} failed — trying next model`);
        continue;
      }

      // Last model exhausted — surface error in the message bubble
      const chunk = `Error: ${errText}`;
      messageService.appendAssistantDelta(threadId, messageId, chunk);
      streamService.publish(threadId, { type: "delta", messageId, chunk });
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
