import { Thread } from "../types/domain";
import { logger } from "../utils/logger";
import { messageService } from "../services/messageService";
import { streamService } from "../services/streamService";
import { threadService } from "../services/threadService";
import { terminalService } from "../services/terminalService";
import { runService } from "../services/runService";

type ActiveRun = {
  runId: string;
  timers: NodeJS.Timeout[];
  stopped: boolean;
};

const activeRuns = new Map<string, ActiveRun>();

const buildStubResponse = (content: string, thread: Thread) => {
  const normalized = content.trim();
  return [
    `Working in ${thread.repoName}.`,
    `You asked: ${normalized}.`,
    "This gateway is connected to a stubbed Claw runtime. Replace the runtime adapter when wiring up RunPod.",
    "I will keep the session warm so you can reconnect quickly.",
  ];
};

export const clawRuntime = {
  async ensureSession(threadId: string, repoName: string) {
    // In the stub runtime we simply ensure metadata exists.
    const thread = threadService.get(threadId);
    if (!thread?.remoteSessionId) {
      threadService.setRemoteSession(threadId, `sess-${repoName}-${threadId}`);
    }
  },

  async sendMessage(
    threadId: string,
    content: string,
    messageId: string
  ): Promise<string> {
    const thread = threadService.get(threadId);
    if (!thread) return;

    await this.ensureSession(threadId, thread.repoName);

    await this.stop(threadId);

    const run = runService.start(threadId);
    threadService.setStatus(threadId, "running");
    streamService.publish(threadId, { type: "status", status: "running" });
    messageService.ensureAssistantMessage(threadId, messageId);

    const lines = buildStubResponse(content, thread);
    const terminalLines = [
      `cd /workspace/${thread.repoName}`,
      `# stub runtime processing "${content.slice(0, 48)}"`,
      "echo \"Streaming partial output...\"",
    ];

    const active: ActiveRun = { runId: run.id, timers: [], stopped: false };
    activeRuns.set(threadId, active);

    const schedule = (
      fn: () => void,
      delay: number
    ) => {
      const timer = setTimeout(() => {
        if (active.stopped) return;
        fn();
      }, delay);
      active.timers.push(timer);
    };

    // Emit terminal lines gradually
    terminalLines.forEach((chunk, index) => {
      schedule(() => {
        terminalService.appendChunk(threadId, chunk);
        streamService.publish(threadId, { type: "terminal", chunk: chunk + "\n" });
      }, 350 * (index + 1));
    });

    const assembled = lines.map((line, index) => ({
      delay: 500 * (index + 1),
      chunk: line + (index === lines.length - 1 ? "" : " "),
    }));

    assembled.forEach(({ delay, chunk }, idx) => {
      schedule(() => {
        messageService.appendAssistantDelta(threadId, messageId, chunk);
        streamService.publish(threadId, { type: "delta", messageId, chunk });
        if (idx === assembled.length - 1) {
          messageService.finalizeAssistant(threadId, messageId);
          streamService.publish(threadId, { type: "done", messageId });
          threadService.setStatus(threadId, "idle");
          runService.markStatus(run.id, "done");
          streamService.publish(threadId, { type: "status", status: "idle" });
          activeRuns.delete(threadId);
        }
      }, delay);
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
    active.timers.forEach((timer) => clearTimeout(timer));
    activeRuns.delete(threadId);
    runService.markStatus(active.runId, "stopped");
    threadService.setStatus(threadId, "idle");
    streamService.publish(threadId, { type: "status", status: "idle" });
    logger.info({ threadId }, "Stopped active run");
  },

  async getTerminalLines(threadId: string) {
    return terminalService.getHistory(threadId);
  },
};
