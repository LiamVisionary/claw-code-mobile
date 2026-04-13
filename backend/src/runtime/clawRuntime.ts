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
  child: ReturnType<typeof spawn>;
  stopped: boolean;
};

const activeRuns = new Map<string, ActiveRun>();

function workspaceDir(threadId: string): string {
  const dir = path.join(WORKSPACES_DIR, threadId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function hasExistingSession(threadId: string): boolean {
  const dir = path.join(workspaceDir(threadId), ".claw", "sessions");
  if (!fs.existsSync(dir)) return false;
  // claw stores sessions in sub-directories: .claw/sessions/<hash>/<session>.jsonl
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith(".jsonl")) return true;
    if (entry.isDirectory()) {
      const sub = path.join(dir, entry.name);
      if (fs.readdirSync(sub).some((f) => f.endsWith(".jsonl"))) return true;
    }
  }
  return false;
}

function buildEnv(model?: ModelConfig): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<
    string,
    string
  >;

  if (model?.apiKey) {
    if (model.provider === "openrouter") {
      // OpenRouter uses the OpenAI-compat env vars
      env["OPENAI_API_KEY"] = model.apiKey;
      env["OPENAI_BASE_URL"] = "https://openrouter.ai/api/v1";
      // Clear anthropic keys so claw picks OpenRouter
      delete env["ANTHROPIC_API_KEY"];
      delete env["ANTHROPIC_AUTH_TOKEN"];
    } else {
      env["ANTHROPIC_API_KEY"] = model.apiKey;
    }
  }

  // Pass model name via env if provided
  if (model?.name) {
    env["CLAW_MODEL"] = model.name;
  }

  return env;
}

function buildArgs(prompt: string, model?: ModelConfig): string[] {
  const args: string[] = ["--output-format", "json"];

  if (model?.name) {
    args.push("--model", model.name);
  }

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

export const clawRuntime = {
  async sendMessage(
    threadId: string,
    content: string,
    messageId: string,
    model?: ModelConfig
  ): Promise<string> {
    const thread = threadService.get(threadId);
    if (!thread) return "";

    if (!fs.existsSync(CLAW_BINARY)) {
      const errMsg =
        "claw binary not found. Run `bash scripts/build-claw.sh` first.";
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

    const cwd = workspaceDir(threadId);
    const args = buildArgs(content, model);
    const env = buildEnv(model);

    logger.info({ threadId, cwd, args }, "Spawning claw");

    const child = spawn(CLAW_BINARY, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const active: ActiveRun = { runId: run.id, child, stopped: false };
    activeRuns.set(threadId, active);

    let stdoutBuf = "";
    let stderrBuf = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuf += text;
      // Forward stderr lines as terminal output in real-time
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          terminalService.appendChunk(threadId, trimmed);
          streamService.publish(threadId, {
            type: "terminal",
            chunk: trimmed + "\n",
          });
        }
      }
    });

    child.on("close", async (code) => {
      activeRuns.delete(threadId);

      if (active.stopped) {
        runService.markStatus(run.id, "stopped");
        return;
      }

      if (code !== 0) {
        const errText = stderrBuf.slice(-300) || `claw exited with code ${code}`;
        logger.error({ code, errText }, "claw exited with error");
        messageService.appendAssistantDelta(threadId, messageId, `Error: ${errText}`);
        messageService.finalizeAssistant(threadId, messageId);
        streamService.publish(threadId, { type: "delta", messageId, chunk: `Error: ${errText}` });
        streamService.publish(threadId, { type: "done", messageId });
        threadService.setStatus(threadId, "error");
        runService.markStatus(run.id, "error");
        streamService.publish(threadId, { type: "status", status: "error" });
        return;
      }

      try {
        const result = JSON.parse(stdoutBuf.trim()) as {
          message: string;
          tool_uses?: Array<{ tool_name: string; input: unknown }>;
          tool_results?: Array<{ content: string }>;
          usage?: { input_tokens: number; output_tokens: number };
          estimated_cost?: string;
        };

        // Emit tool uses as terminal lines
        for (const tu of result.tool_uses ?? []) {
          const line = `[${tu.tool_name}] ${JSON.stringify(tu.input).slice(0, 200)}`;
          terminalService.appendChunk(threadId, line);
          streamService.publish(threadId, { type: "terminal", chunk: line + "\n" });
        }

        // Tool results
        for (const tr of result.tool_results ?? []) {
          if (tr.content) {
            const preview = tr.content.slice(0, 400);
            terminalService.appendChunk(threadId, preview);
            streamService.publish(threadId, { type: "terminal", chunk: preview + "\n" });
          }
        }

        // Emit cost info as a terminal line
        if (result.estimated_cost) {
          const costLine = `Cost: ${result.estimated_cost} | in: ${result.usage?.input_tokens ?? 0} out: ${result.usage?.output_tokens ?? 0}`;
          terminalService.appendChunk(threadId, costLine);
          streamService.publish(threadId, { type: "terminal", chunk: costLine + "\n" });
        }

        // Stream the response text word-by-word
        const msg = result.message ?? "";
        await streamWords(threadId, messageId, msg, () => active.stopped);

        messageService.finalizeAssistant(threadId, messageId);
        streamService.publish(threadId, { type: "done", messageId });
        threadService.setStatus(threadId, "idle");
        runService.markStatus(run.id, "done");
        streamService.publish(threadId, { type: "status", status: "idle" });
      } catch (err: any) {
        logger.error({ err, stdoutBuf }, "Failed to parse claw JSON output");
        const errChunk = `Parse error: ${err.message}\nstdout: ${stdoutBuf.slice(0, 200)}`;
        messageService.appendAssistantDelta(threadId, messageId, errChunk);
        messageService.finalizeAssistant(threadId, messageId);
        streamService.publish(threadId, { type: "delta", messageId, chunk: errChunk });
        streamService.publish(threadId, { type: "done", messageId });
        threadService.setStatus(threadId, "error");
        runService.markStatus(run.id, "error");
        streamService.publish(threadId, { type: "status", status: "error" });
      }
    });

    child.on("error", (err) => {
      logger.error({ err }, "Failed to spawn claw");
      streamService.publish(threadId, {
        type: "error",
        message: `Failed to start claw: ${err.message}`,
      });
      threadService.setStatus(threadId, "error");
      runService.markStatus(run.id, "error");
      streamService.publish(threadId, { type: "status", status: "error" });
      activeRuns.delete(threadId);
    });

    return run.id;
  },

  async stop(threadId: string) {
    const active = activeRuns.get(threadId);
    if (!active) {
      threadService.setStatus(threadId, "idle");
      return;
    }
    active.stopped = true;
    active.child.kill("SIGTERM");
    setTimeout(() => {
      if (!active.child.killed) active.child.kill("SIGKILL");
    }, 2000);
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
