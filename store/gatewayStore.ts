import * as FileSystem from "expo-file-system/legacy";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Native XHR-based SSE client — works in React Native (no `document` dependency).
 * Returns an object with an `abort()` method to close the connection.
 */
function openNativeSSE(
  url: string,
  headers: Record<string, string>,
  onMessage: (event: string, data: string) => void,
  onError: (err: Error) => void
): { abort: () => void } {
  let aborted = false;
  let currentXhr: XMLHttpRequest | null = null;

  function connect() {
    if (aborted) return;
    const xhr = new XMLHttpRequest();
    currentXhr = xhr;
    let offset = 0;
    let currentEvent = "";
    let dataBuffer = "";

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
        scheduleReconnect();
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
            onMessage(currentEvent, dataBuffer);
            currentEvent = "";
            dataBuffer = "";
          }
        }
      }

      // readyState 4 = DONE — connection closed, reconnect
      if (xhr.readyState === 4) {
        scheduleReconnect();
      }
    };

    xhr.onerror = () => {
      onError(new Error("SSE connection failed"));
      scheduleReconnect();
    };

    xhr.send();
  }

  function scheduleReconnect() {
    if (aborted) return;
    setTimeout(connect, 2000);
  }

  connect();
  return { abort: () => { aborted = true; currentXhr?.abort(); } };
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
  streams: Record<string, { abort: () => void } | undefined>;
  loadingThreads: boolean;
  activeThreadId?: string;
  actions: {
    setSettings: (input: Omit<Settings, "modelQueue" | "autoCompact"> & { modelQueue?: ModelEntry[]; autoCompact?: boolean }) => void;
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
      },
      threads: [],
      messages: {},
      terminal: {},
      toolSteps: {},
      permissionRequests: {},
      streams: {},
      loadingThreads: false,
      activeThreadId: undefined,
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
              case "done":
                set((current) => ({
                  threads: current.threads.map((t) =>
                    t.id === threadId ? { ...t, status: "idle" } : t
                  ),
                }));
                break;
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
              case "tool_start":
                set((current) => {
                  const steps = current.toolSteps[threadId] ?? [];
                  const newStep: ToolStep = {
                    id: payload.id ?? `step-${Date.now()}`,
                    tool: payload.tool ?? "unknown",
                    label: payload.label ?? payload.tool ?? "Working…",
                    status: "running",
                    startedAt: Date.now(),
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
      },
    }),
    {
      name: "gateway-settings",
      storage: createJSONStorage(() => fileStorage),
      partialize: (state) => ({ settings: state.settings }),
    }
  )
);
