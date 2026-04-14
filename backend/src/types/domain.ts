export type ThreadStatus = "idle" | "running" | "waiting" | "error";

export interface Thread {
  id: string;
  title: string;
  repoName: string;
  status: ThreadStatus;
  updatedAt: string;
  lastMessagePreview: string;
  remoteSessionId?: string;
  workDir: string;
  createdAt: string;
}

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  threadId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export type RunStatus = "running" | "done" | "stopped" | "error";

export interface Run {
  id: string;
  threadId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
}

export interface TerminalBuffer {
  threadId: string;
  lines: string[];
}

export type StreamEvent =
  | { type: "status"; status: ThreadStatus }
  | { type: "delta"; messageId: string; chunk: string }
  | { type: "terminal"; chunk: string }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string }
  | { type: "tool_start"; id: string; messageId: string; tool: string; label: string }
  | { type: "tool_end"; id: string; messageId: string; error?: boolean }
  | { type: "message_error"; messageId: string; text: string }
  | { type: "run_phase"; phase: string }
  | { type: "compact_start" }
  | { type: "compact_end"; removedMessages: number; keptMessages: number }
  | { type: "permission_request"; id: string; tool: string; description: string; message?: string }
  | { type: "thinking_content"; messageId: string; content: string };
