import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Infer the gateway server URL from Expo's packager host.
 *
 * When running over LAN (plain `expo start`), `hostUri` looks like
 * `192.168.1.12:8081`. The backend listens on the same machine at :5000,
 * so we swap the port and prepend http://. This lets zero-config LAN setups
 * work without touching Settings.
 *
 * Returns "" when hostUri isn't a LAN host (e.g. tunnel mode) — the user
 * is expected to set EXPO_PUBLIC_GATEWAY_URL or fill it in manually.
 */
const inferDefaultServerUrl = (): string => {
  const hostUri =
    (Constants.expoConfig as { hostUri?: string } | null)?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | null)?.debuggerHost ??
    "";
  if (!hostUri) return "";
  const host = hostUri.split("/")[0].split(":")[0];
  if (!host) return "";
  // Skip tunnel hosts — they won't proxy to :5000 on the dev machine.
  if (host.endsWith(".trycloudflare.com") || host.endsWith(".exp.direct") || host.endsWith(".ngrok.io") || host.endsWith(".ngrok-free.app")) {
    return "";
  }
  return `http://${host}:5000`;
};

// ── Telemetry ─────────────────────────────────────────────────────────────
// Mirror every SSE event the client receives and every bubble render the
// client performs into a small buffer, then batch-upload to the backend's
// /events/client endpoint every 2 seconds (or when the buffer fills). This
// gives us a server-side record of exactly what the UI saw and rendered,
// so backend-emission-vs-client-render mismatches can be diffed in the
// `events` table after the fact.

type ClientEventInput = {
  type: string;
  threadId?: string;
  runId?: string;
  payload?: Record<string, unknown>;
};

const telemetryBuffer: ClientEventInput[] = [];
let telemetryFlushTimer: ReturnType<typeof setTimeout> | null = null;
const TELEMETRY_FLUSH_INTERVAL_MS = 2000;
const TELEMETRY_MAX_BUFFER = 200;

function logClientEvent(event: ClientEventInput): void {
  telemetryBuffer.push(event);
  if (telemetryBuffer.length >= TELEMETRY_MAX_BUFFER) {
    void flushTelemetry();
    return;
  }
  if (telemetryFlushTimer === null) {
    telemetryFlushTimer = setTimeout(() => {
      telemetryFlushTimer = null;
      void flushTelemetry();
    }, TELEMETRY_FLUSH_INTERVAL_MS);
  }
}

async function flushTelemetry(): Promise<void> {
  if (telemetryBuffer.length === 0) return;
  // Snapshot + clear so new events during the in-flight POST aren't lost.
  const batch = telemetryBuffer.splice(0, telemetryBuffer.length);
  try {
    const state = useGatewayStore.getState();
    if (!state.settings.telemetryEnabled) return;
    const { serverUrl, bearerToken } = state.settings;
    if (!serverUrl || !bearerToken) return;
    const baseUrl = serverUrl.replace(/\/+$/, "");
    await fetch(`${baseUrl}/events/client`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ events: batch }),
    });
  } catch {
    // Never let telemetry block or error the UI. Dropped batches are
    // acceptable — server-side emission logging is authoritative anyway.
  }
}

/**
 * openNativeSSE — XHR-based SSE client for React Native.
 *
 * The `onMessage` callback may return `true` to signal that the stream has
 * cleanly completed (i.e. the caller processed a `done` event). After that
 * the client will NOT auto-reconnect, which prevents duplicate delivery of
 * error/delta chunks when the underlying ngrok/proxy connection closes right
 * after a run finishes.
 *
 * Key invariant: only ONE XHR is ever open at a time. Before creating a new
 * connection (initial connect or reconnect) we always abort the previous XHR
 * so the server-side subscriber is removed before the new one is added.
 * This prevents the "doubled words" bug where two subscribers both receive
 * every delta event and the store ends up applying each chunk twice.
 */
function openNativeSSE(
  url: string,
  headers: Record<string, string>,
  onMessage: (event: string, data: string) => boolean | void,
  onError: (err: Error) => void,
  onReconnect?: () => void
): { abort: () => void } {
  let aborted = false;
  let completed = false;
  let currentXhr: XMLHttpRequest | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let hasConnectedOnce = false;

  function cancelReconnect() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function connect() {
    if (aborted || completed) return;

    // Always abort the previous XHR before creating a new one so the
    // server-side subscriber is released first. Without this, a slow-closing
    // connection leaves a stale subscriber active and every subsequent event
    // is delivered twice.
    cancelReconnect();
    if (currentXhr) {
      const old = currentXhr;
      currentXhr = null;
      old.abort();
    }

    if (hasConnectedOnce && onReconnect) {
      onReconnect();
    }
    hasConnectedOnce = true;

    const xhr = new XMLHttpRequest();
    currentXhr = xhr;
    let offset = 0;
    let currentEvent = "";
    let dataBuffer = "";
    let partialLine = "";
    let reconnectScheduled = false; // prevent double-scheduling within one XHR lifecycle

    xhr.open("GET", url, true);
    xhr.setRequestHeader("Accept", "text/event-stream");
    xhr.setRequestHeader("Cache-Control", "no-cache");
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }

    // Shared chunk processor — called from both readystatechange and
    // progress handlers. React Native's XHR implementation is inconsistent
    // about which event fires for incremental chunks: some versions fire
    // onreadystatechange on every chunk at readyState 3, others only fire
    // it once and deliver subsequent chunks via onprogress. Listening to
    // both and advancing a shared offset keeps us robust either way.
    const processChunk = () => {
      if (xhr.status !== 0 && xhr.status !== 200) {
        onError(new Error(`SSE status ${xhr.status}`));
        if (!reconnectScheduled) {
          reconnectScheduled = true;
          scheduleReconnect();
        }
        return;
      }

      const responseText = xhr.responseText ?? "";
      if (responseText.length <= offset) return;
      const newText = responseText.slice(offset);
      offset = responseText.length;

      const raw = partialLine + newText;
      const endsWithNewline = raw.endsWith("\n");
      const segments = raw.split("\n");
      partialLine = endsWithNewline ? "" : (segments.pop() ?? "");

      for (const rawLine of segments) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          dataBuffer += (dataBuffer ? "\n" : "") + line.slice(6);
        } else if (line.startsWith(":")) {
          // keep-alive / padding comment — ignore
        } else if (line === "") {
          if (dataBuffer !== "") {
            const isDone = onMessage(currentEvent, dataBuffer);
            if (isDone) completed = true;
            currentEvent = "";
            dataBuffer = "";
          }
        }
      }
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState < 3) return;
      processChunk();

      // readyState 4 = DONE — connection closed by server or proxy
      if (xhr.readyState === 4 && !reconnectScheduled) {
        reconnectScheduled = true;
        scheduleReconnect();
      }
    };

    xhr.onprogress = () => {
      processChunk();
    };

    xhr.onerror = () => {
      onError(new Error("SSE connection failed"));
      if (!reconnectScheduled) {
        reconnectScheduled = true;
        scheduleReconnect();
      }
    };

    xhr.send();
  }

  function scheduleReconnect() {
    if (aborted || completed) return;
    cancelReconnect();
    reconnectTimer = setTimeout(connect, 2000);
  }

  connect();
  return {
    abort: () => {
      aborted = true;
      cancelReconnect();
      if (currentXhr) {
        currentXhr.abort();
        currentXhr = null;
      }
    },
  };
}

const fileStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const uri = FileSystem.documentDirectory + encodeURIComponent(key) + ".json";
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) return null;
      return await FileSystem.readAsStringAsync(uri);
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    const uri = FileSystem.documentDirectory + encodeURIComponent(key) + ".json";
    await FileSystem.writeAsStringAsync(uri, value);
  },
  removeItem: async (key: string): Promise<void> => {
    const uri = FileSystem.documentDirectory + encodeURIComponent(key) + ".json";
    await FileSystem.deleteAsync(uri, { idempotent: true });
  },
};

export type ThreadStatus = "idle" | "running" | "waiting" | "error";

export type Thread = {
  id: string;
  title: string;
  repoName: string;
  status: ThreadStatus;
  updatedAt: string;
  lastMessagePreview: string;
  remoteSessionId?: string;
  workDir: string;
  createdAt: string;
};

export type FsEntry = {
  name: string;
  path: string;
  isDir: boolean;
};

export type FsListing = {
  path: string;
  parent: string | null;
  entries: FsEntry[];
};

export type ToolStepStatus = "running" | "done" | "error";

export type ToolStep = {
  id: string;
  /** e.g. "bash", "edit", "read", "write", "search", "think" */
  tool: string;
  /** Human-readable description, e.g. "Editing app/theme.ts" */
  label: string;
  status: ToolStepStatus;
  /** Timestamp when the step started */
  startedAt: number;
  /** The assistant message this step belongs to — used to show steps in the bubble */
  messageId?: string;
};

export type PermissionRequest = {
  id: string;
  /** e.g. "bash", "edit", "write" */
  tool: string;
  /** What the agent wants to do, e.g. "Run command: rm -rf node_modules" */
  description: string;
  /** Whether we're still waiting for user response */
  pending: boolean;
};

export type MessageRole = "user" | "assistant" | "system";

export type Message = {
  id: string;
  threadId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  /** Set to true when the backend reports a run error for this message */
  error?: boolean;
  /** Chain-of-thought content parsed from <thinking>...</thinking> blocks */
  thinking?: string;
};

type ModelSettings = {
  provider: "claude" | "openrouter" | "local";
  name: string;
  apiKey: string;
};

export type ModelEntry = {
  id: string;
  provider: "claude" | "openrouter" | "local";
  name: string;
  apiKey: string;
  enabled: boolean;
};

type Settings = {
  serverUrl: string;
  bearerToken: string;
  model?: ModelSettings;      // legacy — kept for migration only
  modelQueue: ModelEntry[];   // ordered fallback list (source of truth)
  autoCompact: boolean;       // auto-compact context when window is full
  streamingEnabled: boolean;  // stream response word-by-word (vs. show all at once)
  darkMode: "system" | "light" | "dark";  // appearance preference
  accentTheme: "claude" | "lavender";  // which accent palette to use
  /**
   * Percentage (0–100) of the active model's context window at which to
   * proactively compact the conversation before the next turn. Also used
   * as the threshold for treating an empty-response error as an implicit
   * overflow and triggering a compact+retry.
   */
  autoCompactThreshold: number;
  /**
   * When true, the client mirrors every SSE event it receives and every
   * bubble render it performs to the backend's /events/client endpoint,
   * so backend emission vs client reception can be diffed in the events
   * table for debugging.
   */
  telemetryEnabled: boolean;
  /**
   * When true, the backend fires one synthetic "continue" spawn after a
   * turn that ended with mid-sentence punctuation (":", ",", "—", etc.).
   * Works around GLM-via-OpenRouter voluntarily quitting after a handful
   * of output tokens. Only runs once per user message.
   */
  autoContinueEnabled: boolean;
};

type GatewayState = {
  settings: Settings;
  threads: Thread[];
  messages: Record<string, Message[]>;
  terminal: Record<string, string[]>;
  /** Per-thread tool steps (activity stream) */
  toolSteps: Record<string, ToolStep[]>;
  /** Per-thread pending permission requests */
  permissionRequests: Record<string, PermissionRequest[]>;
  /** Per-thread compacting state */
  compacting: Record<string, boolean>;
  /** Per-thread run phase (authoritative from backend) */
  runPhase: Record<string, string>;
  /**
   * Per-thread timestamp (unix ms) of the most recent `status: running`
   * event. The live ThinkingIndicator uses this to show only tool steps
   * added during the current run without wiping the historical toolSteps
   * that previous bubbles still need for their own badge displays.
   */
  runStartedAt: Record<string, number>;
  streams: Record<string, { abort: () => void } | undefined>;
  loadingThreads: boolean;
  activeThreadId?: string;
  /** True once zustand-persist has finished rehydrating settings from disk */
  _hasHydrated: boolean;
  actions: {
    setSettings: (input: Omit<Settings, "modelQueue" | "autoCompact" | "streamingEnabled" | "darkMode" | "accentTheme" | "autoCompactThreshold" | "telemetryEnabled" | "autoContinueEnabled"> & { modelQueue?: ModelEntry[]; autoCompact?: boolean; streamingEnabled?: boolean; darkMode?: "system" | "light" | "dark"; accentTheme?: "claude" | "lavender"; autoCompactThreshold?: number; telemetryEnabled?: boolean; autoContinueEnabled?: boolean }) => void;
    loadThreads: () => Promise<void>;
    createThread: (workDir?: string) => Promise<Thread>;
    browseFsDirectory: (path?: string) => Promise<FsListing>;
    loadMessages: (threadId: string) => Promise<void>;
    sendMessage: (threadId: string, content: string) => Promise<void>;
    stopRun: (threadId: string) => Promise<void>;
    openStream: (threadId: string) => void;
    closeStream: (threadId: string) => void;
    loadTerminal: (threadId: string) => Promise<void>;
    sendTerminalCommand: (threadId: string, command: string) => Promise<void>;
    setActiveThread: (threadId: string) => void;
    /** Respond to a permission request (approve/deny) */
    respondToPermission: (threadId: string, permissionId: string, approved: boolean) => Promise<void>;
    refreshThread: (threadId: string) => Promise<void>;
    deleteThread: (threadId: string) => Promise<void>;
    duplicateThread: (threadId: string) => Promise<Thread>;
    updateThreadWorkDir: (threadId: string, workDir: string) => Promise<void>;
  };
};

const normalizeUrl = (url: string) => url.replace(/\/+$/, "");

const getClientConfig = (state: GatewayState) => {
  const { serverUrl, bearerToken } = state.settings;
  if (!serverUrl || !bearerToken) {
    throw new Error("Configure server URL and bearer token in settings.");
  }
  return {
    baseUrl: normalizeUrl(serverUrl),
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
  };
};

const upsertMessage = (
  messages: Record<string, Message[]>,
  message: Message
) => {
  const existing = messages[message.threadId] ?? [];
  const idx = existing.findIndex((m) => m.id === message.id);
  if (idx === -1) {
    return {
      ...messages,
      [message.threadId]: [...existing, message],
    };
  }
  const next = [...existing];
  next[idx] = message;
  return { ...messages, [message.threadId]: next };
};

export const useGatewayStore = create<GatewayState>()(
  persist(
    (set, get) => ({
      settings: {
        serverUrl: process.env.EXPO_PUBLIC_GATEWAY_URL ?? inferDefaultServerUrl(),
        bearerToken: process.env.EXPO_PUBLIC_GATEWAY_TOKEN ?? "dev-token",
        modelQueue: [],
        autoCompact: true,
        streamingEnabled: true,
        darkMode: "system",
        accentTheme: "lavender",
        autoCompactThreshold: 70,
        telemetryEnabled: true,
        autoContinueEnabled: true,
      },
      threads: [],
      messages: {},
      terminal: {},
      toolSteps: {},
      permissionRequests: {},
      compacting: {},
      runPhase: {},
      runStartedAt: {},
      streams: {},
      loadingThreads: false,
      activeThreadId: undefined,
      _hasHydrated: false,
      actions: {
        setSettings: (input) =>
          set((state) => ({
            settings: {
              ...state.settings,
              serverUrl: input.serverUrl.trim(),
              bearerToken: input.bearerToken.trim(),
              model: input.model,
              modelQueue: input.modelQueue ?? state.settings.modelQueue ?? [],
              autoCompact: input.autoCompact ?? state.settings.autoCompact ?? true,
              streamingEnabled: input.streamingEnabled ?? state.settings.streamingEnabled ?? true,
              darkMode: input.darkMode ?? state.settings.darkMode ?? "system",
              accentTheme: input.accentTheme ?? state.settings.accentTheme ?? "lavender",
              autoCompactThreshold:
                input.autoCompactThreshold ??
                state.settings.autoCompactThreshold ??
                70,
              telemetryEnabled:
                input.telemetryEnabled ??
                state.settings.telemetryEnabled ??
                true,
              autoContinueEnabled:
                input.autoContinueEnabled ??
                state.settings.autoContinueEnabled ??
                true,
            },
          })),

        loadThreads: async () => {
          const state = get();
          const { baseUrl, headers } = getClientConfig(state);
          set({ loadingThreads: true });
          try {
            const res = await fetch(`${baseUrl}/threads`, { headers });
            if (!res.ok) throw new Error("Failed to load threads");
            const data = await res.json();
            set({ threads: data.threads });
          } finally {
            set({ loadingThreads: false });
          }
        },

        createThread: async (workDir?: string) => {
          const state = get();
          const { baseUrl, headers } = getClientConfig(state);
          const res = await fetch(`${baseUrl}/threads`, {
            method: "POST",
            headers,
            body: JSON.stringify({ workDir }),
          });
          if (!res.ok) throw new Error("Failed to create thread");
          const data = await res.json();
          set((current) => ({
            threads: [data.thread, ...current.threads],
          }));
          return data.thread as Thread;
        },

        browseFsDirectory: async (dirPath?: string) => {
          const state = get();
          const { baseUrl, headers } = getClientConfig(state);
          const url = dirPath
            ? `${baseUrl}/fs/browse?path=${encodeURIComponent(dirPath)}`
            : `${baseUrl}/fs/browse`;
          const res = await fetch(url, { headers });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error((err as any).error ?? "Failed to browse directory");
          }
          return (await res.json()) as FsListing;
        },

        loadMessages: async (threadId: string) => {
          const state = get();
          const { baseUrl, headers } = getClientConfig(state);
          const res = await fetch(`${baseUrl}/threads/${threadId}/messages`, {
            headers,
          });
          if (!res.ok) throw new Error("Failed to load messages");
          const data = await res.json();
          set((current) => ({
            messages: {
              ...current.messages,
              [threadId]: data.messages as Message[],
            },
          }));
        },

        sendMessage: async (threadId: string, content: string) => {
          const state = get();
          const { baseUrl, headers } = getClientConfig(state);
          const userMessage: Message = {
            id: `local-${Date.now()}`,
            threadId,
            role: "user",
            content,
            createdAt: new Date().toISOString(),
          };
          set((current) => ({
            messages: upsertMessage(current.messages, userMessage),
            threads: current.threads.map((t) =>
              t.id === threadId ? { ...t, status: "running" } : t
            ),
          }));

          try {
            const res = await fetch(`${baseUrl}/threads/${threadId}/messages`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                content,
                autoCompact: state.settings.autoCompact ?? true,
                autoCompactThreshold: state.settings.autoCompactThreshold ?? 70,
                autoContinueEnabled: state.settings.autoContinueEnabled ?? true,
                streamingEnabled: state.settings.streamingEnabled ?? true,
                modelQueue: (() => {
                  const q = (state.settings.modelQueue ?? []).filter((m) => m.enabled);
                  if (q.length > 0) return q.map(({ provider, name, apiKey }) => ({ provider, name, apiKey }));
                  if (state.settings.model) {
                    const { provider, name, apiKey } = state.settings.model;
                    return [{ provider, name, apiKey }];
                  }
                  return [];
                })(),
              }),
            });
            if (!res.ok) throw new Error("Failed to send message");
          } catch (err) {
            set((current) => ({
              threads: current.threads.map((t) =>
                t.id === threadId ? { ...t, status: "error" } : t
              ),
            }));
            throw err;
          }
        },

        stopRun: async (threadId: string) => {
          const state = get();
          const { baseUrl, headers } = getClientConfig(state);
          await fetch(`${baseUrl}/threads/${threadId}/stop`, {
            method: "POST",
            headers,
          });
          set((current) => ({
            threads: current.threads.map((t) =>
              t.id === threadId ? { ...t, status: "idle" } : t
            ),
          }));
        },

        openStream: (threadId: string) => {
          const state = get();
          let baseUrl: string;
          let headers: Record<string, string>;
          try {
            ({ baseUrl, headers } = getClientConfig(state));
          } catch {
            return; // not configured yet — skip stream
          }

          const existing = state.streams[threadId];
          if (existing) existing.abort();

          const handleMessage = (eventName: string, data: string) => {
            if (!data) return;
            let payload: any;
            try { payload = JSON.parse(data); } catch { return; }

            // Mirror every received SSE event to the events table so
            // backend emission vs. client reception can be diffed later.
            // Content strings are truncated to 400 chars server-side, so we
            // can safely log the whole payload here.
            logClientEvent({
              type: "client_sse_received",
              threadId,
              payload: { eventName, ...payload },
            });

            switch (eventName) {
              case "status": {
                const sIdle = payload.status === "idle" || payload.status === "error";
                const isRunning = payload.status === "running";
                set((current) => ({
                  threads: current.threads.map((t) =>
                    t.id === threadId ? { ...t, status: payload.status } : t
                  ),
                  ...(sIdle ? {
                    runPhase: { ...current.runPhase, [threadId]: "idle" },
                    compacting: { ...current.compacting, [threadId]: false },
                  } : {}),
                  // On new run start, stamp the run boundary timestamp so the
                  // live indicator can filter to only *this* run's tool steps.
                  // We intentionally do NOT clear `toolSteps` — previous runs'
                  // bubbles still need their historical badges, filtered by
                  // messageId inside MessageBubble.
                  ...(isRunning ? {
                    runStartedAt: { ...current.runStartedAt, [threadId]: Date.now() },
                  } : {}),
                }));
                break;
              }
              case "delta":
                set((current) => {
                  const msgs = current.messages[threadId] ?? [];
                  const existing = msgs.find((m) => m.id === payload.messageId) ?? {
                    id: payload.messageId,
                    threadId,
                    role: "assistant" as const,
                    content: "",
                    createdAt: new Date().toISOString(),
                  };
                  return {
                    messages: upsertMessage(current.messages, {
                      ...existing,
                      content: existing.content + payload.chunk,
                    }),
                  };
                });
                break;
              case "message_error":
                set((current) => {
                  const msgs = current.messages[threadId] ?? [];
                  const existing = msgs.find((m) => m.id === payload.messageId) ?? {
                    id: payload.messageId,
                    threadId,
                    role: "assistant" as const,
                    content: "",
                    createdAt: new Date().toISOString(),
                  };
                  return {
                    messages: upsertMessage(current.messages, {
                      ...existing,
                      content: payload.text || "An error occurred — please try again.",
                      error: true,
                    }),
                  };
                });
                break;
              case "done":
                set((current) => ({
                  threads: current.threads.map((t) =>
                    t.id === threadId ? { ...t, status: "idle" } : t
                  ),
                  runPhase: { ...current.runPhase, [threadId]: "idle" },
                  compacting: { ...current.compacting, [threadId]: false },
                }));
                return true; // signal openNativeSSE to stop reconnecting
              case "terminal":
                set((current) => ({
                  terminal: {
                    ...current.terminal,
                    [threadId]: [
                      ...(current.terminal[threadId] ?? []),
                      payload.chunk.replace(/\n$/, ""),
                    ].slice(-400),
                  },
                }));
                break;
              case "error":
                set((current) => ({
                  threads: current.threads.map((t) =>
                    t.id === threadId ? { ...t, status: "error" } : t
                  ),
                }));
                break;
              // --- Tool step events (graceful: if backend doesn't send them, nothing breaks) ---
              case "thinking_content":
                set((current) => {
                  const msgs = current.messages[threadId] ?? [];
                  const existing = msgs.find((m) => m.id === payload.messageId) ?? {
                    id: payload.messageId,
                    threadId,
                    role: "assistant" as const,
                    content: "",
                    createdAt: new Date().toISOString(),
                  };
                  return {
                    messages: upsertMessage(current.messages, {
                      ...existing,
                      thinking: payload.content,
                    }),
                  };
                });
                break;
              case "tool_start":
                set((current) => {
                  const steps = current.toolSteps[threadId] ?? [];
                  const stepId = payload.id ?? `step-${Date.now()}`;
                  // Dedupe by id — the backend replay buffer will re-send
                  // state-mutating events on reconnect, and clients that
                  // already received the original should not double-add.
                  if (steps.some((s) => s.id === stepId)) return current;
                  const newStep: ToolStep = {
                    id: stepId,
                    tool: payload.tool ?? "unknown",
                    label: payload.label ?? payload.tool ?? "Working…",
                    status: "running",
                    startedAt: Date.now(),
                    messageId: payload.messageId,
                  };
                  return {
                    toolSteps: {
                      ...current.toolSteps,
                      [threadId]: [...steps, newStep],
                    },
                  };
                });
                break;
              case "tool_end":
                set((current) => {
                  const steps = current.toolSteps[threadId] ?? [];
                  return {
                    toolSteps: {
                      ...current.toolSteps,
                      [threadId]: steps.map((s) =>
                        s.id === (payload.id ?? payload.stepId)
                          ? { ...s, status: (payload.error ? "error" : "done") as ToolStepStatus }
                          : s
                      ),
                    },
                  };
                });
                break;
              case "compact_start":
                set((current) => ({
                  compacting: { ...current.compacting, [threadId]: true },
                }));
                break;
              case "compact_end":
                set((current) => {
                  const removed = payload.removedMessages ?? 0;
                  const kept = payload.keptMessages ?? 0;
                  const systemMsg: Message = {
                    id: `compact-${Date.now()}`,
                    threadId,
                    role: "system" as const,
                    content: removed > 0
                      ? `Compacted context — removed ${removed} messages, kept ${kept}`
                      : "Compaction attempted — nothing to remove",
                    createdAt: new Date().toISOString(),
                  };
                  return {
                    compacting: { ...current.compacting, [threadId]: false },
                    messages: upsertMessage(current.messages, systemMsg),
                  };
                });
                break;
              case "run_phase":
                set((current) => {
                  const phase = payload.phase ?? "idle";
                  return {
                    runPhase: { ...current.runPhase, [threadId]: phase },
                    compacting: {
                      ...current.compacting,
                      [threadId]: phase === "compacting",
                    },
                  };
                });
                break;
              case "permission_request":
                set((current) => {
                  const reqs = current.permissionRequests[threadId] ?? [];
                  const newReq: PermissionRequest = {
                    id: payload.id ?? `perm-${Date.now()}`,
                    tool: payload.tool ?? "unknown",
                    description: payload.description ?? payload.message ?? "Agent requests permission",
                    pending: true,
                  };
                  return {
                    permissionRequests: {
                      ...current.permissionRequests,
                      [threadId]: [...reqs, newReq],
                    },
                    // Also set thread status to "waiting"
                    threads: current.threads.map((t) =>
                      t.id === threadId ? { ...t, status: "waiting" } : t
                    ),
                  };
                });
                break;
            }
          };

          const sse = openNativeSSE(
            `${baseUrl}/threads/${threadId}/stream`,
            headers,
            handleMessage,
            (err) => console.warn("SSE error", err),
            () => {
              get().actions.refreshThread(threadId).catch(() => {});
            }
          );

          set((current) => ({
            streams: { ...current.streams, [threadId]: sse },
          }));
        },

        closeStream: (threadId: string) => {
          get().streams[threadId]?.abort();
          set((current) => {
            const next = { ...current.streams };
            delete next[threadId];
            return { streams: next };
          });
        },

        loadTerminal: async (threadId: string) => {
          const state = get();
          const { baseUrl, headers } = getClientConfig(state);
          const res = await fetch(`${baseUrl}/threads/${threadId}/terminal`, {
            headers,
          });
          if (!res.ok) throw new Error("Failed to fetch terminal");
          const data = await res.json();
          set((current) => ({
            terminal: { ...current.terminal, [threadId]: data.lines as string[] },
          }));
        },

        sendTerminalCommand: async (threadId: string, command: string) => {
          const state = get();
          const { baseUrl, headers } = getClientConfig(state);
          await fetch(`${baseUrl}/threads/${threadId}/terminal`, {
            method: "POST",
            headers,
            body: JSON.stringify({ command }),
          });
        },

        setActiveThread: (threadId: string) => set({ activeThreadId: threadId }),

        respondToPermission: async (threadId: string, permissionId: string, approved: boolean) => {
          const state = get();
          const { baseUrl, headers } = getClientConfig(state);
          await fetch(`${baseUrl}/threads/${threadId}/permissions/${permissionId}`, {
            method: "POST",
            headers,
            body: JSON.stringify({ approved }),
          });
        },

        refreshThread: async (threadId: string) => {
          const state = get();
          let baseUrl: string;
          let headers: Record<string, string>;
          try {
            ({ baseUrl, headers } = getClientConfig(state));
          } catch {
            return;
          }
          try {
            const [threadRes, msgRes, runStateRes] = await Promise.all([
              fetch(`${baseUrl}/threads`, { headers }),
              fetch(`${baseUrl}/threads/${threadId}/messages`, { headers }),
              fetch(`${baseUrl}/threads/${threadId}/run-state`, { headers }),
            ]);
            let phase: string | null = null;
            if (runStateRes.ok) {
              const rs = await runStateRes.json();
              phase = rs.phase ?? "idle";
            }
            if (threadRes.ok) {
              const data = await threadRes.json();
              const freshThread = (data.threads as Thread[]).find((t) => t.id === threadId);
              if (freshThread) {
                const isIdle = freshThread.status !== "running" && freshThread.status !== "waiting";
                const resolvedPhase = isIdle ? "idle" : (phase ?? "idle");
                set((current) => ({
                  threads: current.threads.map((t) =>
                    t.id === threadId ? { ...t, ...freshThread } : t
                  ),
                  runPhase: {
                    ...current.runPhase,
                    [threadId]: resolvedPhase,
                  },
                  compacting: {
                    ...current.compacting,
                    [threadId]: resolvedPhase === "compacting",
                  },
                  ...(isIdle ? {
                    toolSteps: {
                      ...current.toolSteps,
                      [threadId]: (current.toolSteps[threadId] ?? []).map((s) =>
                        s.status === "running" ? { ...s, status: "done" as ToolStepStatus } : s
                      ),
                    },
                  } : {}),
                }));
              }
            }
            if (msgRes.ok) {
              const data = await msgRes.json();
              set((current) => ({
                messages: {
                  ...current.messages,
                  [threadId]: data.messages as Message[],
                },
              }));
            }
          } catch {}
        },

        deleteThread: async (threadId: string) => {
          const state = get();
          const { baseUrl, headers } = getClientConfig(state);
          const res = await fetch(`${baseUrl}/threads/${threadId}`, {
            method: "DELETE",
            headers,
          });
          if (!res.ok) throw new Error("Failed to delete thread");
          set((current) => ({
            threads: current.threads.filter((t) => t.id !== threadId),
            messages: (() => {
              const next = { ...current.messages };
              delete next[threadId];
              return next;
            })(),
          }));
        },

        duplicateThread: async (threadId: string) => {
          const state = get();
          const { baseUrl, headers } = getClientConfig(state);
          const res = await fetch(`${baseUrl}/threads/${threadId}/duplicate`, {
            method: "POST",
            headers,
          });
          if (!res.ok) throw new Error("Failed to duplicate thread");
          const data = await res.json();
          const copy = data.thread as Thread;
          set((current) => ({
            threads: [copy, ...current.threads],
          }));
          return copy;
        },

        updateThreadWorkDir: async (threadId: string, workDir: string) => {
          const state = get();
          const { baseUrl, headers } = getClientConfig(state);
          const res = await fetch(`${baseUrl}/threads/${threadId}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ workDir }),
          });
          if (!res.ok) throw new Error("Failed to update thread");
          const data = await res.json();
          const updated = data.thread as Thread;
          set((current) => ({
            threads: current.threads.map((t) => (t.id === threadId ? updated : t)),
          }));
        },
      },
    }),
    {
      name: "gateway-settings",
      storage: createJSONStorage(() => fileStorage),
      partialize: (state) => ({ settings: state.settings }),
      onRehydrateStorage: () => (state) => {
        // Prefer EXPO_PUBLIC_GATEWAY_URL / EXPO_PUBLIC_GATEWAY_TOKEN when set
        // — these are baked into the bundle by scripts/dev-tunnel.mjs and must
        // override stale persisted values so each Metro restart auto-updates
        // the app's server URL. Fall back to persisted, then inferred defaults.
        if (state) {
          const s = state.settings;
          const patch: Partial<typeof s> = {};
          const envUrl = process.env.EXPO_PUBLIC_GATEWAY_URL;
          const envToken = process.env.EXPO_PUBLIC_GATEWAY_TOKEN;
          if (envUrl && envUrl !== s.serverUrl) {
            patch.serverUrl = envUrl;
          } else if (!s.serverUrl) {
            const inferred = inferDefaultServerUrl();
            if (inferred) patch.serverUrl = inferred;
          }
          if (envToken && envToken !== s.bearerToken) {
            patch.bearerToken = envToken;
          } else if (!s.bearerToken) {
            patch.bearerToken = "dev-token";
          }
          // Backfill fields that didn't exist on earlier installs. Without
          // this, `if (!state.settings.telemetryEnabled) return;` in the
          // flush path silently drops every client event because the
          // persisted blob pre-dates the field.
          if (s.telemetryEnabled === undefined) patch.telemetryEnabled = true;
          if (s.autoCompactThreshold === undefined) patch.autoCompactThreshold = 70;
          if (s.accentTheme === undefined) patch.accentTheme = "lavender";
          if (s.autoContinueEnabled === undefined) patch.autoContinueEnabled = true;
          if (Object.keys(patch).length) {
            useGatewayStore.setState({
              settings: { ...s, ...patch },
            });
          }
        }
        useGatewayStore.setState({ _hasHydrated: true });
      },
    }
  )
);
