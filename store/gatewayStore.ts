import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ThreadStatus = "idle" | "running" | "waiting" | "error";

export type Thread = {
  id: string;
  title: string;
  repoName: string;
  status: ThreadStatus;
  updatedAt: string;
  lastMessagePreview: string;
  remoteSessionId?: string;
  createdAt: string;
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

type Settings = {
  serverUrl: string;
  bearerToken: string;
  model?: ModelSettings;
};

type GatewayState = {
  settings: Settings;
  threads: Thread[];
  messages: Record<string, Message[]>;
  terminal: Record<string, string[]>;
  streams: Record<string, AbortController | undefined>;
  loadingThreads: boolean;
  activeThreadId?: string;
  actions: {
    setSettings: (input: Settings) => void;
    loadThreads: () => Promise<void>;
    createThread: () => Promise<Thread>;
    loadMessages: (threadId: string) => Promise<void>;
    sendMessage: (threadId: string, content: string) => Promise<void>;
    stopRun: (threadId: string) => Promise<void>;
    openStream: (threadId: string) => Promise<void>;
    closeStream: (threadId: string) => void;
    loadTerminal: (threadId: string) => Promise<void>;
    sendTerminalCommand: (threadId: string, command: string) => Promise<void>;
    setActiveThread: (threadId: string) => void;
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
      },
      threads: [],
      messages: {},
      terminal: {},
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

        createThread: async () => {
          const state = get();
          const { baseUrl, headers } = getClientConfig(state);
          const res = await fetch(`${baseUrl}/threads`, {
            method: "POST",
            headers,
            body: JSON.stringify({}),
          });
          if (!res.ok) throw new Error("Failed to create thread");
          const data = await res.json();
          set((current) => ({
            threads: [data.thread, ...current.threads],
          }));
          return data.thread as Thread;
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
              body: JSON.stringify({ content }),
            });
            if (!res.ok) {
              throw new Error("Failed to send message");
            }
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

        openStream: async (threadId: string) => {
          const state = get();
          const { baseUrl, headers } = getClientConfig(state);

          const existing = state.streams[threadId];
          if (existing) {
            existing.abort();
          }
          const controller = new AbortController();
          set((current) => ({
            streams: { ...current.streams, [threadId]: controller },
          }));

          fetchEventSource(`${baseUrl}/threads/${threadId}/stream`, {
            method: "GET",
            headers,
            signal: controller.signal,
            openWhenHidden: true,
            onmessage(event) {
              if (!event.data) return;
              const payload = JSON.parse(event.data);
              const evt = event.event;
              switch (evt) {
                case "status":
                  set((current) => ({
                    threads: current.threads.map((t) =>
                      t.id === threadId ? { ...t, status: payload.status } : t
                    ),
                  }));
                  break;
                case "delta": {
                  set((current) => {
                    const existing =
                      current.messages[threadId]?.find(
                        (m) => m.id === payload.messageId
                      ) ??
                      ({
                        id: payload.messageId,
                        threadId,
                        role: "assistant",
                        content: "",
                        createdAt: new Date().toISOString(),
                      } as Message);
                    const updated: Message = {
                      ...existing,
                      content: `${existing.content}${payload.chunk}`,
                    };
                    return {
                      messages: upsertMessage(current.messages, updated),
                    };
                  });
                  break;
                }
                case "done": {
                  set((current) => ({
                    threads: current.threads.map((t) =>
                      t.id === threadId ? { ...t, status: "idle" } : t
                    ),
                  }));
                  break;
                }
                case "terminal": {
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
                }
                case "error": {
                  set((current) => ({
                    threads: current.threads.map((t) =>
                      t.id === threadId ? { ...t, status: "error" } : t
                    ),
                  }));
                  break;
                }
              }
            },
            onerror(err) {
              console.warn("Stream error", err);
              set((current) => ({
                threads: current.threads.map((t) =>
                  t.id === threadId ? { ...t, status: "error" } : t
                ),
              }));
            },
          }).catch((err) => {
            console.warn("Stream closed", err);
          });
        },

        closeStream: (threadId: string) => {
          const controller = get().streams[threadId];
          controller?.abort();
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
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ settings: state.settings }),
    }
  )
);
