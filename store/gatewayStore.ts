import * as FileSystem from "expo-file-system/legacy";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

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
  onError: (err: Error) => void
): { abort: () => void } {
  let aborted = false;
  let completed = false;
  let currentXhr: XMLHttpRequest | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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

    const xhr = new XMLHttpRequest();
    currentXhr = xhr;
    let offset = 0;
    let currentEvent = "";
    let dataBuffer = "";
    let reconnectScheduled = false; // prevent double-scheduling within one XHR lifecycle

    xhr.open("GET", url, true);
    xhr.setRequestHeader("Accept", "text/event-stream");
    xhr.setRequestHeader("Cache-Control", "no-cache");
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }

    xhr.onreadystatechange = () => {
      if (xhr.readyState < 3) return;

      if (xhr.status !== 0 && xhr.status !== 200) {
        onError(new Error(`SSE status ${xhr.status}`));
        if (!reconnectScheduled) {
          reconnectScheduled = true;
          scheduleReconnect();
        }
        return;
      }

      const newText = xhr.responseText.slice(offset);
      offset = xhr.responseText.length;

      for (const line of newText.split("\n")) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          dataBuffer += (dataBuffer ? "\n" : "") + line.slice(6);
        } else if (line.startsWith(":")) {
          // keep-alive comment — ignore
        } else if (line === "") {
          if (dataBuffer !== "") {
            const isDone = onMessage(currentEvent, dataBuffer);
            if (isDone) completed = true;
            currentEvent = "";
            dataBuffer = "";
          }
        }
      }

      // readyState 4 = DONE — connection closed by server or proxy
      if (xhr.readyState === 4 && !reconnectScheduled) {
        reconnectScheduled = true;
        scheduleReconnect();
      }
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
  streams: Record<string, { abort: () => void } | undefined>;
  loadingThreads: boolean;
  activeThreadId?: string;
  /** True once zustand-persist has finished rehydrating settings from disk */
  _hasHydrated: boolean;
  actions: {
    setSettings: (input: Omit<Settings, "modelQueue" | "autoCompact" | "streamingEnabled"> & { modelQueue?: ModelEntry[]; autoCompact?: boolean; streamingEnabled?: boolean }) => void;
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
        serverUrl: process.env.EXPO_PUBLIC_GATEWAY_URL ?? "",
        bearerToken: process.env.EXPO_PUBLIC_GATEWAY_TOKEN ?? "",
        modelQueue: [],
        autoCompact: true,
        streamingEnabled: true,
      },
      threads: [],
      messages: {},
      terminal: {},
      toolSteps: {},
      permissionRequests: {},
      compacting: {},
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

            switch (eventName) {
              case "status":
                set((current) => ({
                  threads: current.threads.map((t) =>
                    t.id === threadId ? { ...t, status: payload.status } : t
                  ),
                }));
                break;
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
                      content: payload.text,
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
                  const newStep: ToolStep = {
                    id: payload.id ?? `step-${Date.now()}`,
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
            (err) => console.warn("SSE error", err)
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
      onRehydrateStorage: () => () => {
        useGatewayStore.setState({ _hasHydrated: true });
      },
    }
  )
);
