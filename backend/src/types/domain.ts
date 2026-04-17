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

export interface TurnToolStep {
  id: string;
  tool: string;
  label: string;
  detail?: string;
  status: "done" | "error";
}

/**
 * Display-only turn metadata stored as a JSON blob. Queryable fields
 * (model, tokensIn, tokensOut, costUsd, turnDurationMs) live as real
 * columns so aggregate reports don't have to parse the blob.
 */
export interface MessageMetadata {
  thinking?: string;
  turnLog?: string[];
  toolSteps?: TurnToolStep[];
}

export interface Message {
  id: string;
  threadId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  error?: boolean;
  /** Queryable turn telemetry (real columns). */
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  turnDurationMs?: number;
  /** Display-only blob. */
  metadata?: MessageMetadata;
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
  | { type: "terminal"; chunk: string; cwd?: string; busy?: boolean }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string }
  | { type: "tool_start"; id: string; messageId: string; tool: string; label: string; detail?: string }
  | { type: "tool_end"; id: string; messageId: string; error?: boolean }
  | { type: "message_error"; messageId: string; text: string }
  | { type: "run_phase"; phase: string }
  | { type: "compact_start" }
  | {
      type: "compact_end";
      removedMessages: number;
      keptMessages: number;
      /** Rough bytes→tokens estimate of what the compact removed. */
      approxTokensFreed?: number;
      /** Persisted system message the backend wrote to SQLite so the
       *  compact summary survives refresh. */
      systemMessage?: {
        id: string;
        threadId: string;
        content: string;
        createdAt: string;
      };
    }
  | { type: "permission_request"; id: string; tool: string; description: string; message?: string }
  | { type: "thinking_content"; messageId: string; content: string };
