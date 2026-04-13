import { query, type SDKMessage } from "@anthropic-ai/claude-code";
import { logger } from "../utils/logger";
import { messageService } from "../services/messageService";
import { streamService } from "../services/streamService";
import { threadService } from "../services/threadService";
import { terminalService } from "../services/terminalService";
import { runService } from "../services/runService";

export type ModelConfig = {
  provider: "claude" | "openrouter" | "local";
  name?: string;
  apiKey?: string;
};

type ActiveRun = {
  runId: string;
  abortController: AbortController;
  stopped: boolean;
};

const activeRuns = new Map<string, ActiveRun>();
const conversationHistory = new Map<string, SDKMessage[]>();

export const clawRuntime = {
  async sendMessage(
    threadId: string,
    content: string,
    messageId: string,
    model?: ModelConfig
  ): Promise<string> {
    const thread = threadService.get(threadId);
    if (!thread) return "";

    await this.stop(threadId);

    const run = runService.start(threadId);
    threadService.setStatus(threadId, "running");
    streamService.publish(threadId, { type: "status", status: "running" });
    messageService.ensureAssistantMessage(threadId, messageId);

    const abortController = new AbortController();
    const active: ActiveRun = { runId: run.id, abortController, stopped: false };
    activeRuns.set(threadId, active);

    const prevMessages = conversationHistory.get(threadId) ?? [];

    const options: Record<string, unknown> = {
      maxTurns: 10,
    };

    if (model?.name) {
      options.model = model.name;
    }
    if (model?.apiKey) {
      options.apiKey = model.apiKey;
      if (model.provider === "openrouter") {
        options.baseURL = "https://openrouter.ai/api/v1";
      }
    } else if (process.env.ANTHROPIC_API_KEY) {
      options.apiKey = process.env.ANTHROPIC_API_KEY;
    }

    (async () => {
      try {
        const newMessages: SDKMessage[] = [];

        for await (const msg of query({
          prompt: content,
          abortController,
          options,
          messages: prevMessages.length > 0 ? prevMessages : undefined,
        })) {
          if (active.stopped) break;
          newMessages.push(msg);

          if (msg.type === "assistant") {
            const content = msg.message.content;

            // Stream text blocks as deltas
            for (const block of content) {
              if (block.type === "text" && block.text) {
                messageService.appendAssistantDelta(threadId, messageId, block.text);
                streamService.publish(threadId, { type: "delta", messageId, chunk: block.text });
              }
            }

            // Emit tool calls as terminal lines
            for (const block of content) {
              if (block.type === "tool_use") {
                const inputStr = JSON.stringify(block.input ?? {});
                const line = `[${block.name}] ${inputStr.slice(0, 200)}`;
                terminalService.appendChunk(threadId, line);
                streamService.publish(threadId, { type: "terminal", chunk: line + "\n" });
              }
            }
          } else if (msg.type === "user") {
            // Tool results
            const contentArr = Array.isArray(msg.message.content)
              ? msg.message.content
              : [];
            for (const block of contentArr) {
              if ((block as any).type === "tool_result") {
                const inner = (block as any).content;
                const text = Array.isArray(inner)
                  ? inner
                      .filter((c: any) => c.type === "text")
                      .map((c: any) => c.text)
                      .join("")
                  : String(inner ?? "");
                if (text) {
                  const trimmed = text.slice(0, 500);
                  terminalService.appendChunk(threadId, trimmed);
                  streamService.publish(threadId, { type: "terminal", chunk: trimmed + "\n" });
                }
              }
            }
          }
        }

        // Persist conversation history for next turn
        conversationHistory.set(threadId, [...prevMessages, ...newMessages]);

        messageService.finalizeAssistant(threadId, messageId);
        streamService.publish(threadId, { type: "done", messageId });
        threadService.setStatus(threadId, "idle");
        runService.markStatus(run.id, "done");
        streamService.publish(threadId, { type: "status", status: "idle" });
      } catch (err: any) {
        if (!active.stopped) {
          logger.error({ err, threadId }, "Claude Code runtime error");
          streamService.publish(threadId, { type: "error", message: err.message ?? "Unknown error" });
          threadService.setStatus(threadId, "error");
          runService.markStatus(run.id, "error");
          streamService.publish(threadId, { type: "status", status: "error" });
        }
      } finally {
        activeRuns.delete(threadId);
      }
    })();

    return run.id;
  },

  async stop(threadId: string) {
    const active = activeRuns.get(threadId);
    if (!active) {
      threadService.setStatus(threadId, "idle");
      return;
    }
    active.stopped = true;
    active.abortController.abort();
    activeRuns.delete(threadId);
    runService.markStatus(active.runId, "stopped");
    threadService.setStatus(threadId, "idle");
    streamService.publish(threadId, { type: "status", status: "idle" });
    logger.info({ threadId }, "Stopped active run");
  },

  async getTerminalLines(threadId: string) {
    return terminalService.getHistory(threadId);
  },

  clearHistory(threadId: string) {
    conversationHistory.delete(threadId);
  },
};
