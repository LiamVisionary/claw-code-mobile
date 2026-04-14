import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  Animated,
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import Markdown from "react-native-markdown-display";
import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams, useNavigation } from "expo-router";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import * as AC from "@bacons/apple-colors";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { IconSymbol } from "@/components/ui/IconSymbol";
import SlashCommandPicker from "@/components/SlashCommandPicker";
import DirectoryBrowser from "@/components/DirectoryBrowser";
import { useGatewayStore } from "@/store/gatewayStore";
import type { Message, ToolStep, PermissionRequest, ThreadStatus, ModelEntry } from "@/store/gatewayStore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BORDER_RADIUS, SPACING, SHADOW, TYPOGRAPHY } from "@/constants/theme";

// Stable empty arrays — prevents Zustand `?? []` from returning a new reference
// on every store update and causing infinite re-renders.
const EMPTY_STEPS: ToolStep[] = [];
const EMPTY_REQS: PermissionRequest[] = [];
const EMPTY_MESSAGES: Message[] = [];
const EMPTY_TERMINAL: string[] = [];

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const actions = useGatewayStore((s) => s.actions);
  const thread = useGatewayStore((s) =>
    s.threads.find((t) => t.id === id)
  );
  const messageMap = useGatewayStore((s) => s.messages);
  const terminalMap = useGatewayStore((s) => s.terminal);
  const toolSteps = useGatewayStore((s) => s.toolSteps[id ?? ""] ?? EMPTY_STEPS);
  const rawPermReqs = useGatewayStore((s) => s.permissionRequests[id ?? ""] ?? EMPTY_REQS);
  const isCompacting = useGatewayStore((s) => s.compacting[id ?? ""] ?? false);
  const runPhase = useGatewayStore((s) => s.runPhase[id ?? ""] ?? "idle");
  const permissionReqs = useMemo(
    () => rawPermReqs.filter((r) => r.pending),
    [rawPermReqs]
  );
  const messages = messageMap[id ?? ""] ?? EMPTY_MESSAGES;
  const terminalLines = terminalMap[id ?? ""] ?? EMPTY_TERMINAL;
  const listRef = useRef<FlatList<Message>>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [slashPickerVisible, setSlashPickerVisible] = useState(false);
  const [command, setCommand] = useState("");
  const [copiedConvo, setCopiedConvo] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [showDirBrowser, setShowDirBrowser] = useState(false);
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const settings = useGatewayStore((s) => s.settings);
  // Tracks the previous thread status so we can detect idle transitions
  const prevStatusRef = useRef<ThreadStatus>("idle");
  const terminalRef = useRef<BottomSheetModal>(null);
  const { bottom } = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  // Track whether messages were successfully loaded so we never accidentally
  // delete a thread whose messages just failed to fetch.
  const messagesLoaded = useRef(false);

  useEffect(() => {
    if (!id) return;
    actions.setActiveThread(id);
    actions.loadMessages(id)
      .then(() => { messagesLoaded.current = true; })
      .catch(() => {});
    actions.loadTerminal(id).catch(() => {});
    actions.openStream(id);
    return () => actions.closeStream(id);
  }, [id, actions]);

  // Auto-delete empty threads when the user navigates away without sending any messages.
  // Also refresh thread state on re-focus to catch missed SSE events.
  useFocusEffect(
    useCallback(() => {
      if (id) {
        actions.refreshThread(id).catch(() => {});
      }
      return () => {
        if (!id || !messagesLoaded.current) return;
        const currentMessages = useGatewayStore.getState().messages[id] ?? [];
        if (currentMessages.length === 0) {
          actions.deleteThread(id).catch(() => {});
        }
      };
    }, [id, actions])
  );

  // Refresh thread state when app returns from background
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && id) {
        actions.refreshThread(id).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [id, actions]);

  useEffect(() => {
    if (id && !thread) {
      actions.loadThreads().catch(() => {});
    }
  }, [id, thread, actions]);

  useEffect(() => {
    // Scroll when a new message arrives or claw starts running (ThinkingIndicator appears)
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  const handleInputChange = (text: string) => {
    setInput(text);
    setSlashPickerVisible(text.startsWith("/") && text.length > 0);
  };

  const threadStatus = thread?.status ?? "idle";

  const sendNow = useCallback(async (msg: string) => {
    if (!id || !msg.trim()) return;
    setSending(true);
    try {
      await actions.sendMessage(id, msg.trim());
    } catch {
      // errors handled in store
    } finally {
      setSending(false);
    }
  }, [id, actions]);

  const send = async () => {
    if (!id || !input.trim()) return;
    const msg = input.trim();
    setInput("");
    setSlashPickerVisible(false);
    // If AI is busy, park the message in the queue instead of sending
    if (threadStatus === "running" || threadStatus === "waiting") {
      setQueuedMessage(msg);
      return;
    }
    await sendNow(msg);
  };

  // Auto-send queued message when the AI becomes idle
  const queuedRef = useRef<string | null>(null);
  queuedRef.current = queuedMessage;
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = threadStatus;
    if (
      (prev === "running" || prev === "waiting") &&
      threadStatus === "idle" &&
      queuedRef.current
    ) {
      const msg = queuedRef.current;
      setQueuedMessage(null);
      sendNow(msg);
    }
  }, [threadStatus, sendNow]);

  const onStop = useCallback(() => {
    if (id) {
      actions.stopRun(id);
    }
  }, [id, actions]);

  const copyConversation = useCallback(async () => {
    if (!messages.length) return;
    const text = messages
      .map((m) => `${m.role === "user" ? "You" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    await Clipboard.setStringAsync(text);
    setCopiedConvo(true);
    setTimeout(() => setCopiedConvo(false), 2000);
  }, [messages]);

  const headerRight = useMemo(
    () => (
      <View style={{ flexDirection: "row", gap: 8 }}>
        {threadStatus === "running" && (
          <TouchableBounce sensory onPress={onStop}>
            <View
              style={{
                width: 32,
                height: 32,
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: AC.systemRed,
                borderRadius: BORDER_RADIUS.full,
              }}
            >
              <IconSymbol name="stop.fill" color="#fff" size={12} />
            </View>
          </TouchableBounce>
        )}
        <TouchableBounce
          sensory
          onPress={() => {
            actions.loadTerminal(id!).catch(() => {});
            terminalRef.current?.present();
          }}
        >
          <View
            style={{
              width: 32,
              height: 32,
              justifyContent: "center",
              alignItems: "center",
              backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
              borderRadius: BORDER_RADIUS.full,
            }}
          >
            <IconSymbol name="terminal" color={AC.label} size={14} />
          </View>
        </TouchableBounce>
        <TouchableBounce
          sensory
          disabled={!messages.length}
          onPress={copyConversation}
          style={{ opacity: messages.length ? 1 : 0.3 }}
        >
          <View
            style={{
              width: 32,
              height: 32,
              justifyContent: "center",
              alignItems: "center",
              backgroundColor: copiedConvo
                ? AC.systemGreen
                : isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
              borderRadius: BORDER_RADIUS.full,
            }}
          >
            <IconSymbol
              name={copiedConvo ? "checkmark" : "doc.on.doc"}
              color={copiedConvo ? "#fff" : AC.label}
              size={14}
            />
          </View>
        </TouchableBounce>
      </View>
    ),
    [threadStatus, id, actions, onStop, messages.length, copiedConvo, isDark]
  );

  // Imperatively update the navigator header so it reacts to settings changes
  // (zustand store updates don't always trigger a Stack.Screen options re-read).
  useEffect(() => {
    const queue = (settings.modelQueue ?? []).filter((m) => m.enabled);
    const active = queue[0] ?? null;

    navigation.setOptions({
      headerTitle: () => {
        if (!active) {
          return (
            <Text style={{ color: AC.label, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>
              {thread?.title ?? "Chat"}
            </Text>
          );
        }
        const dotColor = PROVIDER_COLOR[active.provider] ?? "#6B7280";
        const shortName = active.name.includes("/")
          ? active.name.split("/").pop()!
          : active.name;
        return (
          <TouchableBounce sensory onPress={() => setModelPickerOpen((v) => !v)}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 5,
                backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)",
                borderRadius: BORDER_RADIUS.full,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)",
              }}
            >
              <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: dotColor }} />
              <Text
                style={{ color: AC.label, fontSize: 13, fontWeight: "600", maxWidth: 180 }}
                numberOfLines={1}
              >
                {shortName}
              </Text>
              <IconSymbol
                name={modelPickerOpen ? "chevron.up" : "chevron.down"}
                size={9}
                color={isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)"}
              />
            </View>
          </TouchableBounce>
        );
      },
      headerRight: () => headerRight,
    });
  }, [settings.modelQueue, thread?.title, modelPickerOpen, isDark, headerRight]);

  const liveThinking = useMemo(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "assistant" && lastMsg.thinking) return lastMsg.thinking;
    return "";
  }, [messages]);

  const listFooterElem = useMemo(() => {
    const lastMsg = messages[messages.length - 1];
    const phaseActive = runPhase !== "idle";
    const needsIndicator =
      isCompacting ||
      phaseActive ||
      threadStatus === "waiting" ||
      (threadStatus === "running" && (!lastMsg || lastMsg.role === "user"));
    return needsIndicator ? (
      <ThinkingIndicator
        status={threadStatus}
        toolSteps={toolSteps}
        permissionRequests={permissionReqs}
        onApprove={(permId) => actions.respondToPermission(id ?? "", permId, true)}
        onDeny={(permId) => actions.respondToPermission(id ?? "", permId, false)}
        isDark={isDark}
        isCompacting={isCompacting}
        runPhase={runPhase}
        thinkingContent={liveThinking}
      />
    ) : null;
  }, [threadStatus, messages, toolSteps, permissionReqs, actions, id, isDark, isCompacting, runPhase, liveThinking]);

  const listFooterComponent = useCallback(() => listFooterElem, [listFooterElem]);

  if (!thread) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: AC.systemGroupedBackground,
        }}
      >
        <Text style={{ color: AC.label, fontSize: 16 }}>Thread not found</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: AC.systemGroupedBackground }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={80}
    >
      <Stack.Screen />
      <View
        style={{
          flex: 1,
          paddingBottom: bottom,
        }}
      >
        {/* Model picker */}
        <ModelPickerBar
          open={modelPickerOpen}
          onToggle={() => setModelPickerOpen((v) => !v)}
          isDark={isDark}
        />

        {/* Messages */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            padding: SPACING.lg,
            gap: SPACING.sm,
            flexGrow: 1,
          }}
          onScrollBeginDrag={() => setModelPickerOpen(false)}
          renderItem={({ item }) => item.role === "system"
            ? <SystemLine message={item} isDark={isDark} />
            : <MessageBubble message={item} threadId={id ?? ""} />
          }
          ListFooterComponent={listFooterComponent}
          ListEmptyComponent={() => (
            <View
              style={{
                flex: 1,
                justifyContent: "center",
                alignItems: "center",
                gap: SPACING.sm,
                paddingVertical: 48,
              }}
            >
              <View style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                justifyContent: "center",
                alignItems: "center",
              }}>
                <IconSymbol
                  name="ellipsis.bubble"
                  color={AC.systemGray3}
                  size={22}
                />
              </View>
              <Text style={{ color: AC.systemGray, fontSize: 14 }}>
                Start a conversation
              </Text>
            </View>
          )}
        />

        {/* Slash command picker — floats above the input bar */}
        <SlashCommandPicker
          inputValue={input}
          visible={slashPickerVisible}
          onSelect={(cmd) => {
            setInput(cmd);
            setSlashPickerVisible(false);
          }}
        />

        {/* Queued message panel — shown when a message is waiting to be sent */}
        {queuedMessage !== null && (
          <QueuedMessagePanel
            message={queuedMessage}
            isDark={isDark}
            onEdit={() => {
              setInput(queuedMessage);
              setQueuedMessage(null);
            }}
            onSendNow={() => {
              const msg = queuedMessage;
              setQueuedMessage(null);
              sendNow(msg);
            }}
            onDelete={() => setQueuedMessage(null)}
          />
        )}

        {/* Input bar - clean, minimal */}
        <View
          style={{
            paddingHorizontal: SPACING.lg,
            paddingTop: SPACING.sm,
            paddingBottom: SPACING.sm,
            gap: SPACING.sm,
          }}
        >
          {/* Directory badge — tappable on turn 0, read-only otherwise */}
          {thread.workDir ? (
            <TouchableBounce
              sensory
              disabled={messages.length > 0}
              onPress={() => setShowDirBrowser(true)}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  alignSelf: "flex-start",
                  gap: 5,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                  borderRadius: BORDER_RADIUS.full,
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.07)",
                }}
              >
                <Text style={{ fontSize: 11 }}>📁</Text>
                <Text
                  style={{
                    color: AC.secondaryLabel,
                    fontSize: 12,
                    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                    maxWidth: 220,
                  }}
                  numberOfLines={1}
                >
                  {thread.workDir.split("/").filter(Boolean).pop() ?? thread.workDir}
                </Text>
                {messages.length === 0 && (
                  <IconSymbol
                    name="chevron.down"
                    size={10}
                    color={AC.secondaryLabel as any}
                  />
                )}
              </View>
            </TouchableBounce>
          ) : null}

          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: SPACING.sm,
              backgroundColor: isDark ? "#1c1c1e" : "#fff",
              borderRadius: 22,
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,255,255,0.08)" : AC.separator,
              paddingHorizontal: SPACING.md,
              paddingVertical: SPACING.xs,
              ...SHADOW.sm,
            }}
          >
            <TextInput
              placeholder="Message…"
              placeholderTextColor={AC.systemGray3}
              value={input}
              onChangeText={handleInputChange}
              multiline
              style={{
                minHeight: 40,
                maxHeight: 120,
                color: AC.label,
                fontSize: TYPOGRAPHY.fontSizes.md,
                lineHeight: TYPOGRAPHY.lineHeights.md,
                paddingVertical: SPACING.sm,
                flex: 1,
              }}
            />
            <TouchableBounce
              sensory
              disabled={!input.trim()}
              onPress={send}
              style={{
                opacity: !input.trim() ? 0.3 : 1,
                marginBottom: SPACING.xs,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: input.trim() ? AC.label : (isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"),
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <IconSymbol
                  name="arrow.up"
                  size={14}
                  color={input.trim() ? (isDark ? "#000" : "#fff") : AC.systemGray3}
                />
              </View>
            </TouchableBounce>
          </View>
        </View>
      </View>

      {/* Directory browser — only available on turn 0 */}
      <DirectoryBrowser
        visible={showDirBrowser}
        onSelect={(path) => {
          setShowDirBrowser(false);
          if (id) actions.updateThreadWorkDir(id, path).catch(() => {});
        }}
        onCancel={() => setShowDirBrowser(false)}
      />

      <BottomSheetModal
        ref={terminalRef}
        snapPoints={["40%", "70%"]}
        backgroundStyle={{
          backgroundColor: AC.systemBackground,
        }}
        handleIndicatorStyle={{ backgroundColor: AC.systemGray3 }}
      >
        <View style={{ flex: 1, padding: SPACING.md, gap: SPACING.md }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: AC.label, fontWeight: "600", fontSize: 15 }}>
              Terminal
            </Text>
            <TouchableBounce
              sensory
              onPress={() => terminalRef.current?.dismiss()}
            >
              <View style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                justifyContent: "center",
                alignItems: "center",
              }}>
                <IconSymbol name="xmark" color={AC.systemGray} size={12} />
              </View>
            </TouchableBounce>
          </View>
          <View
            style={{
              flex: 1,
              backgroundColor: "#0a0a0a",
              borderRadius: BORDER_RADIUS.lg,
              padding: SPACING.md,
              gap: SPACING.xs,
            }}
          >
            <FlatList
              data={terminalLines}
              keyExtractor={(_, index) => `${index}`}
              renderItem={({ item }) => (
                <Text
                  style={{
                    color: "#a8e6a8",
                    fontFamily: Platform.select({
                      ios: "Menlo",
                      android: "monospace",
                      default: "monospace",
                    }),
                    fontSize: 12,
                    lineHeight: 18,
                  }}
                >
                  {item}
                </Text>
              )}
            />
          </View>
          <View style={{ flexDirection: "row", gap: SPACING.sm, alignItems: "center" }}>
            <TextInput
              value={command}
              onChangeText={setCommand}
              placeholder="Run a command"
              placeholderTextColor={AC.systemGray3}
              style={{
                flex: 1,
                backgroundColor: isDark ? "#1c1c1e" : AC.secondarySystemGroupedBackground,
                borderRadius: BORDER_RADIUS.md,
                paddingHorizontal: SPACING.md,
                paddingVertical: SPACING.sm,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.06)" : AC.separator,
                color: AC.label,
                fontSize: 14,
              }}
            />
            <TouchableBounce
              sensory
              disabled={!command.trim()}
              onPress={() => {
                if (!id || !command.trim()) return;
                actions.sendTerminalCommand(id, command.trim());
                setCommand("");
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: command.trim() ? AC.label : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)"),
                  justifyContent: "center",
                  alignItems: "center",
                  opacity: command.trim() ? 1 : 0.5,
                }}
              >
                <IconSymbol name="arrow.up" color={command.trim() ? (isDark ? "#000" : "#fff") : AC.systemGray3} size={14} />
              </View>
            </TouchableBounce>
          </View>
        </View>
      </BottomSheetModal>
    </KeyboardAvoidingView>
  );
}

const EMPTY_BUBBLE_STEPS: ToolStep[] = [];

/** Theme-aware styles for react-native-markdown-display inside assistant bubbles */
function useMarkdownStyles(isDark: boolean) {
  return useMemo(() => {
    const fg       = isDark ? "#ECEDEE" : "#1C1C1E";
    const muted    = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)";
    const codeBg   = isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.055)";
    const codeBorder = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
    const mono     = Platform.OS === "ios" ? "Menlo" : "monospace";
    const base     = 15;
    const lh       = 22;
    return {
      body:      { color: fg, fontSize: base, lineHeight: lh },
      paragraph: { color: fg, fontSize: base, lineHeight: lh, marginTop: 0, marginBottom: 5 },
      heading1:  { color: fg, fontSize: 20, fontWeight: "700" as const, marginTop: 12, marginBottom: 6 },
      heading2:  { color: fg, fontSize: 17, fontWeight: "700" as const, marginTop: 10, marginBottom: 4 },
      heading3:  { color: fg, fontSize: 15, fontWeight: "600" as const, marginTop: 8, marginBottom: 2 },
      strong:    { fontWeight: "700" as const },
      em:        { fontStyle: "italic" as const },
      s:         { textDecorationLine: "line-through" as const },
      link:      { color: "#0A84FF", textDecorationLine: "none" as const },
      blockquote: {
        backgroundColor: codeBg,
        borderLeftWidth: 3,
        borderLeftColor: muted,
        paddingLeft: 10,
        paddingVertical: 4,
        marginVertical: 6,
        borderRadius: 4,
      },
      code_inline: {
        backgroundColor: codeBg,
        fontFamily: mono,
        fontSize: 13,
        borderRadius: 4,
        paddingHorizontal: 4,
        paddingVertical: 1,
        color: isDark ? "#E879F9" : "#7C3AED",
      },
      fence: {
        backgroundColor: codeBg,
        fontFamily: mono,
        fontSize: 12.5,
        lineHeight: 19,
        borderRadius: 8,
        padding: 12,
        marginVertical: 6,
        borderWidth: 1,
        borderColor: codeBorder,
        color: fg,
      },
      code_block: {
        backgroundColor: codeBg,
        fontFamily: mono,
        fontSize: 12.5,
        lineHeight: 19,
        borderRadius: 8,
        padding: 12,
        marginVertical: 6,
        borderWidth: 1,
        borderColor: codeBorder,
        color: fg,
      },
      hr:           { backgroundColor: codeBorder, height: 1, marginVertical: 12 },
      bullet_list:  { marginVertical: 3 },
      ordered_list: { marginVertical: 3 },
      list_item:    { marginBottom: 3 },
      bullet_list_icon: { color: muted, fontSize: 14, marginRight: 6, marginTop: 2 },
      ordered_list_icon:{ color: muted, fontSize: 14, marginRight: 6, marginTop: 2 },
    };
  }, [isDark]);
}

function SystemLine({ message, isDark }: { message: Message; isDark: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 4,
      }}
    >
      <View
        style={{
          flex: 1,
          height: 1,
          backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
        }}
      />
      <Text
        style={{
          color: isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)",
          fontSize: 11,
          fontWeight: "500",
          fontStyle: "italic",
        }}
      >
        {message.content}
      </Text>
      <View
        style={{
          flex: 1,
          height: 1,
          backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
        }}
      />
    </View>
  );
}

function MessageBubble({ message, threadId }: { message: Message; threadId: string }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const mdStyles = useMarkdownStyles(isDark);

  // Tool steps for THIS message — only populated for assistant messages after a run.
  // Separate selector + useMemo avoids creating new arrays on every store update.
  const allThreadSteps = useGatewayStore((s) => s.toolSteps[threadId] ?? EMPTY_BUBBLE_STEPS);
  const msgSteps = useMemo(() => {
    if (isUser) return EMPTY_BUBBLE_STEPS;
    const filtered = allThreadSteps.filter((st) => st.messageId === message.id);
    return filtered.length > 0 ? filtered : EMPTY_BUBBLE_STEPS;
  }, [allThreadSteps, message.id, isUser]);

  const onCopy = useCallback(async () => {
    await Clipboard.setStringAsync(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [message.content]);

  // One badge per call (capped at 8 visible), for the collapsed icon strip
  const MAX_BADGE = 8;
  const visibleStepBadges = useMemo(() => msgSteps.slice(0, MAX_BADGE), [msgSteps]);
  const stepOverflow = Math.max(0, msgSteps.length - MAX_BADGE);

  return (
    <View
      style={{
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: 4,
      }}
    >
      {/* ── Thinking block (collapsible, assistant only) ─────────── */}
      {!isUser && message.thinking && (
        <View style={{ maxWidth: "88%", gap: 3 }}>
          <TouchableBounce sensory onPress={() => setThinkingExpanded((v) => !v)}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                alignSelf: "flex-start",
                paddingHorizontal: 9,
                paddingVertical: 4,
                backgroundColor: isDark ? "rgba(20,184,166,0.12)" : "rgba(20,184,166,0.08)",
                borderRadius: BORDER_RADIUS.full,
                borderWidth: 1,
                borderColor: isDark ? "rgba(20,184,166,0.25)" : "rgba(20,184,166,0.18)",
              }}
            >
              <IconSymbol name="brain.head.profile" size={10} color="#14B8A6" />
              <Text style={{ color: "#14B8A6", fontSize: 11, fontWeight: "600" }}>
                Thinking
              </Text>
              <IconSymbol
                name={thinkingExpanded ? "chevron.up" : "chevron.down"}
                size={9}
                color="#14B8A6"
              />
            </View>
          </TouchableBounce>
          {thinkingExpanded && (
            <View
              style={{
                backgroundColor: isDark ? "rgba(20,184,166,0.06)" : "rgba(20,184,166,0.04)",
                borderRadius: BORDER_RADIUS.lg,
                borderWidth: 1,
                borderColor: isDark ? "rgba(20,184,166,0.18)" : "rgba(20,184,166,0.12)",
                paddingHorizontal: 12,
                paddingVertical: 10,
                maxWidth: "100%",
              }}
            >
              <Text
                style={{
                  color: isDark ? "rgba(255,255,255,0.50)" : "rgba(0,0,0,0.45)",
                  fontSize: 12,
                  lineHeight: 18,
                  fontStyle: "italic",
                }}
              >
                {message.thinking}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ── Tool steps strip (assistant only, when steps exist) ─── */}
      {!isUser && msgSteps.length > 0 && (
        <View style={{ maxWidth: "88%", gap: 4 }}>
          {/* Collapsed header — tap to expand */}
          <TouchableBounce sensory onPress={() => setStepsExpanded((v) => !v)}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 5,
                backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                borderRadius: BORDER_RADIUS.full,
                alignSelf: "flex-start",
              }}
            >
              {/* One icon badge per call */}
              {visibleStepBadges.map((step) => {
                const meta = TOOL_META[step.tool] ?? TOOL_META.unknown;
                return (
                  <View
                    key={step.id}
                    style={{
                      width: 16, height: 16, borderRadius: 4,
                      backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)",
                      justifyContent: "center", alignItems: "center",
                    }}
                  >
                    <IconSymbol name={meta.icon as any} size={9} color={meta.color} />
                  </View>
                );
              })}
              {stepOverflow > 0 && (
                <Text style={{ color: isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.32)", fontSize: 10, fontWeight: "600" }}>
                  +{stepOverflow}
                </Text>
              )}
              <Text style={{ color: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)", fontSize: 11, fontWeight: "500" }}>
                {msgSteps.length} {msgSteps.length === 1 ? "step" : "steps"}
              </Text>
              <IconSymbol
                name={stepsExpanded ? "chevron.up" : "chevron.down"}
                size={10}
                color={isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.28)"}
              />
            </View>
          </TouchableBounce>

          {/* Expanded step list */}
          {stepsExpanded && (
            <View
              style={{
                backgroundColor: isDark ? "#1c1c1e" : "#fff",
                borderRadius: BORDER_RADIUS.lg,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)",
                paddingHorizontal: 12,
                paddingVertical: 8,
                gap: 6,
                ...SHADOW.sm,
              }}
            >
              {msgSteps.map((step) => {
                const meta = TOOL_META[step.tool] ?? TOOL_META.unknown;
                const isErr = step.status === "error";
                return (
                  <View key={step.id} style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                    {isErr
                      ? <IconSymbol name="xmark.circle.fill" size={12} color="#EF4444" />
                      : <IconSymbol name="checkmark.circle.fill" size={12} color="#22C55E" />
                    }
                    <View
                      style={{
                        width: 18, height: 18, borderRadius: 4,
                        backgroundColor: `${meta.color}20`,
                        justifyContent: "center", alignItems: "center",
                      }}
                    >
                      <IconSymbol name={meta.icon as any} size={10} color={meta.color} />
                    </View>
                    <Text
                      style={{
                        color: isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.5)",
                        fontSize: 11.5,
                        fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                        flexShrink: 1,
                      }}
                      numberOfLines={1}
                    >
                      {step.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      {/* ── Message bubble ─────────────────────────────────────── */}
      <TouchableBounce sensory onPress={onCopy}>
        {message.error ? (
          /* ── Error bubble ── */
          <View
            style={{
              width: "92%",
              backgroundColor: isDark ? "rgba(239,68,68,0.10)" : "rgba(239,68,68,0.07)",
              borderRadius: BORDER_RADIUS.lg,
              borderWidth: 1,
              borderColor: isDark ? "rgba(239,68,68,0.25)" : "rgba(239,68,68,0.20)",
              paddingHorizontal: SPACING.md,
              paddingVertical: SPACING.sm + 2,
              ...SHADOW.sm,
            }}
          >
            <Text
              selectable
              style={{
                color: isDark ? "#FCA5A5" : "#B91C1C",
                fontSize: TYPOGRAPHY.fontSizes.sm,
                lineHeight: TYPOGRAPHY.lineHeights.md,
              }}
            >
              {"⚠ "}{(message.content || "An error occurred — please try again.").slice(0, 500)}
            </Text>
          </View>
        ) : (
          /* ── Normal bubble ── */
          <View
            style={{
              maxWidth: isUser ? "80%" : "92%",
              backgroundColor: isUser
                ? AC.systemBlue
                : isDark
                  ? "#1c1c1e"
                  : "#fff",
              borderRadius: BORDER_RADIUS.xl,
              borderBottomRightRadius: isUser ? SPACING.xs : BORDER_RADIUS.xl,
              borderBottomLeftRadius: isUser ? BORDER_RADIUS.xl : SPACING.xs,
              paddingHorizontal: SPACING.md,
              paddingVertical: SPACING.sm + 2,
              borderWidth: isUser ? 0 : 1,
              borderColor: isDark ? "rgba(255,255,255,0.06)" : AC.separator,
              ...(isUser ? SHADOW.md : SHADOW.sm),
            }}
          >
            {isUser ? (
              <Text
                style={{
                  color: "#fff",
                  fontSize: TYPOGRAPHY.fontSizes.md,
                  lineHeight: TYPOGRAPHY.lineHeights.md,
                }}
              >
                {message.content}
              </Text>
            ) : (
              <Markdown style={mdStyles}>
                {message.content}
              </Markdown>
            )}
          </View>
        )}
      </TouchableBounce>

      {/* Timestamp */}
      <Text
        style={{
          color: isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.20)",
          fontSize: 10,
          paddingHorizontal: SPACING.sm,
          marginTop: -1,
          alignSelf: isUser ? "flex-end" : "flex-start",
        }}
      >
        {formatMsgTime(message.createdAt)}
      </Text>

      {/* Subtle copy indicator */}
      {copied && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 3,
            paddingHorizontal: SPACING.sm,
          }}
        >
          <IconSymbol name="checkmark" size={10} color={AC.systemGreen} />
          <Text style={{ fontSize: 11, color: AC.systemGreen }}>Copied</Text>
        </View>
      )}
    </View>
  );
}

// ─── Message timestamp helper ─────────────────────────────────────────────────

function formatMsgTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now   = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const msgDay     = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (msgDay === todayStart) return time;
  if (todayStart - msgDay <= 86_400_000) return `Yesterday ${time}`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " + time;
}

// ─── Queued message panel ─────────────────────────────────────────────────────

function QueuedMessagePanel({
  message,
  isDark,
  onEdit,
  onSendNow,
  onDelete,
}: {
  message: string;
  isDark: boolean;
  onEdit: () => void;
  onSendNow: () => void;
  onDelete: () => void;
}) {
  const bg     = isDark ? "#2c2415" : "#fffbeb";
  const border = isDark ? "rgba(245,158,11,0.30)" : "rgba(245,158,11,0.40)";
  const amber  = "#f59e0b";
  const subtle = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.40)";

  return (
    <View
      style={{
        marginHorizontal: SPACING.lg,
        marginBottom: SPACING.xs,
        backgroundColor: bg,
        borderRadius: BORDER_RADIUS.lg,
        borderWidth: 1,
        borderColor: border,
        overflow: "hidden",
        ...SHADOW.sm,
      }}
    >
      {/* Header row */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: 4,
          gap: 5,
        }}
      >
        <IconSymbol name="clock.arrow.2.circlepath" size={11} color={amber} />
        <Text style={{ color: amber, fontSize: 11, fontWeight: "600", flex: 1 }}>
          Queued — will send when ready
        </Text>
      </View>

      {/* Message preview */}
      <Text
        style={{
          color: isDark ? "rgba(255,255,255,0.80)" : "rgba(0,0,0,0.75)",
          fontSize: 13.5,
          lineHeight: 19,
          paddingHorizontal: 12,
          paddingBottom: 10,
        }}
        numberOfLines={4}
      >
        {message}
      </Text>

      {/* Action row */}
      <View
        style={{
          flexDirection: "row",
          borderTopWidth: 1,
          borderTopColor: border,
        }}
      >
        {/* Edit */}
        <TouchableBounce sensory onPress={onEdit} style={{ flex: 1 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              paddingVertical: 9,
              borderRightWidth: 1,
              borderRightColor: border,
            }}
          >
            <IconSymbol name="pencil" size={12} color={subtle} />
            <Text style={{ color: subtle, fontSize: 12, fontWeight: "500" }}>Edit</Text>
          </View>
        </TouchableBounce>

        {/* Send now */}
        <TouchableBounce sensory onPress={onSendNow} style={{ flex: 1 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              paddingVertical: 9,
              borderRightWidth: 1,
              borderRightColor: border,
            }}
          >
            <IconSymbol name="arrow.up" size={12} color={amber} />
            <Text style={{ color: amber, fontSize: 12, fontWeight: "600" }}>Send now</Text>
          </View>
        </TouchableBounce>

        {/* Delete */}
        <TouchableBounce sensory onPress={onDelete} style={{ flex: 1 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              paddingVertical: 9,
            }}
          >
            <IconSymbol name="xmark" size={12} color={subtle} />
            <Text style={{ color: subtle, fontSize: 12, fontWeight: "500" }}>Remove</Text>
          </View>
        </TouchableBounce>
      </View>
    </View>
  );
}

// ─── Model picker ─────────────────────────────────────────────────────────────

const PROVIDER_COLOR: Record<string, string> = {
  claude:      "#0066FF",
  openrouter:  "#7B3FE4",
  local:       "#16A34A",
};

function ModelPickerBar({
  open,
  onToggle,
  isDark,
}: {
  open: boolean;
  onToggle: () => void;
  isDark: boolean;
}) {
  const settings = useGatewayStore((s) => s.settings);
  const actions  = useGatewayStore((s) => s.actions);
  const queue    = (settings.modelQueue ?? []).filter((m) => m.enabled);

  if (queue.length === 0) return null;

  const selectModel = (entry: ModelEntry) => {
    const newQueue = [entry, ...settings.modelQueue.filter((m) => m.id !== entry.id)];
    actions.setSettings({
      serverUrl:       settings.serverUrl,
      bearerToken:     settings.bearerToken,
      model:           settings.model,
      modelQueue:      newQueue,
      autoCompact:     settings.autoCompact,
      streamingEnabled: settings.streamingEnabled,
    });
    onToggle();
  };

  const dropBg     = isDark ? "#1c1c1e" : "#fff";
  const dropBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

  return (
    <>
      {/* Dropdown — rendered in a Modal so it's never clipped by parent overflow */}
      <Modal
        transparent
        visible={open}
        animationType="none"
        onRequestClose={onToggle}
      >
        <Pressable
          style={{ flex: 1 }}
          onPress={onToggle}
        >
          {/* Position the card near the top-center of the screen */}
          <View
            style={{
              paddingTop: 110,
              alignItems: "center",
            }}
          >
            <Pressable>
              <View
                style={{
                  backgroundColor: dropBg,
                  borderRadius: BORDER_RADIUS.lg,
                  borderWidth: 1,
                  borderColor: dropBorder,
                  minWidth: 220,
                  overflow: "hidden",
                  ...SHADOW.md,
                }}
              >
                {queue.map((entry, i) => {
                  const isActive = i === 0;
                  const color    = PROVIDER_COLOR[entry.provider] ?? "#6B7280";
                  const name     = entry.name.includes("/") ? entry.name.split("/").pop()! : entry.name;
                  return (
                    <TouchableBounce key={entry.id} sensory onPress={() => selectModel(entry)}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 9,
                          paddingHorizontal: 14,
                          paddingVertical: 11,
                          borderBottomWidth: i < queue.length - 1 ? 1 : 0,
                          borderBottomColor: dropBorder,
                          backgroundColor: isActive
                            ? isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"
                            : "transparent",
                        }}
                      >
                        <View
                          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }}
                        />
                        <Text
                          style={{
                            flex: 1,
                            color: isDark ? "#fff" : "#000",
                            fontSize: 13.5,
                            fontWeight: isActive ? "600" : "400",
                          }}
                          numberOfLines={1}
                        >
                          {name}
                        </Text>
                        {isActive && (
                          <IconSymbol name="checkmark" size={12} color={color} />
                        )}
                      </View>
                    </TouchableBounce>
                  );
                })}
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/** SF Symbol name + accent color for each tool type */
const TOOL_META: Record<string, { icon: string; color: string }> = {
  bash:    { icon: "terminal",                   color: "#A855F7" },
  edit:    { icon: "pencil",                     color: "#3B82F6" },
  write:   { icon: "square.and.pencil",          color: "#3B82F6" },
  read:    { icon: "doc.text",                   color: "#6B7280" },
  cat:     { icon: "doc.text",                   color: "#6B7280" },
  search:  { icon: "magnifyingglass",            color: "#F97316" },
  grep:    { icon: "magnifyingglass",            color: "#F97316" },
  glob:    { icon: "folder",                     color: "#F97316" },
  ls:      { icon: "folder",                     color: "#6B7280" },
  think:   { icon: "brain.head.profile",         color: "#14B8A6" },
  diff:    { icon: "arrow.left.arrow.right",     color: "#8B5CF6" },
  git:     { icon: "arrow.triangle.branch",      color: "#F59E0B" },
  mv:      { icon: "arrow.right.doc.on.clipboard", color: "#6B7280" },
  cp:      { icon: "doc.on.doc",                 color: "#6B7280" },
  rm:      { icon: "trash",                      color: "#EF4444" },
  mkdir:   { icon: "folder.badge.plus",          color: "#22C55E" },
  write_file:         { icon: "square.and.pencil",          color: "#3B82F6" },
  str_replace_editor: { icon: "pencil",                     color: "#3B82F6" },
  unknown: { icon: "hammer",                     color: "#6B7280" },
};

const THINKING_PHRASES = [
  "thinking",
  "cooking",
  "whipping that cream",
  "making magic",
  "galloping that horse",
  "cleaning the kitchen",
  "sweeping the floors",
  "big braining",
  "connecting the pieces",
];

/** Cycling text label with three pulsing period dots at text baseline */
function CyclingLabel({ color }: { color: string }) {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const op1 = useRef(new Animated.Value(1)).current;
  const op2 = useRef(new Animated.Value(0.2)).current;
  const op3 = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    const makePulse = (val: Animated.Value) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: 1,   duration: 320, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0.2, duration: 320, useNativeDriver: true }),
        ])
      );

    const a1 = makePulse(op1);
    a1.start();
    const animRefs: Animated.CompositeAnimation[] = [a1];
    const t1 = setTimeout(() => { const a = makePulse(op2); a.start(); animRefs.push(a); }, 213);
    const t2 = setTimeout(() => { const a = makePulse(op3); a.start(); animRefs.push(a); }, 426);

    const phraseTimer = setInterval(() => {
      setPhraseIdx((i) => (i + 1) % THINKING_PHRASES.length);
    }, 2800);

    return () => {
      animRefs.forEach((a) => a.stop());
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(phraseTimer);
    };
  }, []);

  return (
    <Text style={{ color, fontSize: 13, fontWeight: "500" }}>
      {THINKING_PHRASES[phraseIdx]}
      <Animated.Text style={{ opacity: op1 }}>.</Animated.Text>
      <Animated.Text style={{ opacity: op2 }}>.</Animated.Text>
      <Animated.Text style={{ opacity: op3 }}>.</Animated.Text>
    </Text>
  );
}

function CompactingLabel({ color }: { color: string }) {
  const op1 = useRef(new Animated.Value(1)).current;
  const op2 = useRef(new Animated.Value(0.2)).current;
  const op3 = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    const makePulse = (val: Animated.Value) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: 1,   duration: 320, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0.2, duration: 320, useNativeDriver: true }),
        ])
      );

    const a1 = makePulse(op1);
    a1.start();
    const animRefs: Animated.CompositeAnimation[] = [a1];
    const t1 = setTimeout(() => { const a = makePulse(op2); a.start(); animRefs.push(a); }, 213);
    const t2 = setTimeout(() => { const a = makePulse(op3); a.start(); animRefs.push(a); }, 426);

    return () => {
      animRefs.forEach((a) => a.stop());
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <Text style={{ color, fontSize: 13, fontWeight: "500" }}>
      compacting
      <Animated.Text style={{ opacity: op1 }}>.</Animated.Text>
      <Animated.Text style={{ opacity: op2 }}>.</Animated.Text>
      <Animated.Text style={{ opacity: op3 }}>.</Animated.Text>
    </Text>
  );
}

function RespondingLabel({ color }: { color: string }) {
  const op1 = useRef(new Animated.Value(1)).current;
  const op2 = useRef(new Animated.Value(0.2)).current;
  const op3 = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    const makePulse = (val: Animated.Value) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: 1,   duration: 320, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0.2, duration: 320, useNativeDriver: true }),
        ])
      );

    const a1 = makePulse(op1);
    a1.start();
    const animRefs: Animated.CompositeAnimation[] = [a1];
    const t1 = setTimeout(() => { const a = makePulse(op2); a.start(); animRefs.push(a); }, 213);
    const t2 = setTimeout(() => { const a = makePulse(op3); a.start(); animRefs.push(a); }, 426);

    return () => {
      animRefs.forEach((a) => a.stop());
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <Text style={{ color, fontSize: 13, fontWeight: "500" }}>
      responding
      <Animated.Text style={{ opacity: op1 }}>.</Animated.Text>
      <Animated.Text style={{ opacity: op2 }}>.</Animated.Text>
      <Animated.Text style={{ opacity: op3 }}>.</Animated.Text>
    </Text>
  );
}

function ThinkingIndicator({
  status,
  toolSteps,
  permissionRequests,
  onApprove,
  onDeny,
  isDark,
  isCompacting = false,
  runPhase = "idle",
  thinkingContent = "",
}: {
  status: ThreadStatus;
  toolSteps: ToolStep[];
  permissionRequests: PermissionRequest[];
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  isDark: boolean;
  isCompacting?: boolean;
  runPhase?: string;
  thinkingContent?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  const runningStep  = toolSteps.find((s) => s.status === "running") ?? null;
  const finishedSteps = toolSteps.filter((s) => s.status !== "running");
  const badgeSteps   = runningStep ? [...finishedSteps, runningStep] : finishedSteps;
  const MAX_VISIBLE  = 8;
  const visibleBadges = badgeSteps.slice(-MAX_VISIBLE);
  const hiddenCount   = Math.max(0, badgeSteps.length - MAX_VISIBLE);
  const hasBadges    = badgeSteps.length > 0;
  const hasThinking  = thinkingContent.length > 0;
  const dotColor     = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.35)";
  const bubbleBg     = isDark ? "#1c1c1e" : "#fff";
  const bubbleBorder = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const tappable     = hasBadges || hasThinking;

  return (
    <View style={{ gap: 6, paddingTop: SPACING.xs }}>

      {/* ── Compact inline label + badges ────────────────── */}
      <TouchableBounce sensory onPress={tappable ? () => {
        if (hasThinking && !hasBadges) {
          setThinkingExpanded((v) => !v);
        } else {
          setExpanded((v) => !v);
          if (!expanded && hasThinking) setThinkingExpanded(true);
        }
      } : undefined}>
        <View
          style={{
            alignSelf: "flex-start",
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingVertical: 4,
          }}
        >
          {isCompacting || runPhase === "compacting"
            ? <CompactingLabel color="#F59E0B" />
            : runPhase === "responding"
              ? <RespondingLabel color={dotColor} />
              : <CyclingLabel color={dotColor} />
          }

          {hasThinking && !hasBadges && (
            <IconSymbol
              name={thinkingExpanded ? "chevron.up" : "chevron.down"}
              size={9}
              color={dotColor}
            />
          )}

          {hasBadges && (
            <View style={{ width: 1, height: 14, backgroundColor: dotColor, opacity: 0.25, marginHorizontal: 1 }} />
          )}

          {visibleBadges.map((step) => {
            const meta      = TOOL_META[step.tool] ?? TOOL_META.unknown;
            const isRunning = step.status === "running";
            return (
              <View
                key={step.id}
                style={{
                  width: 22, height: 22, borderRadius: 6,
                  backgroundColor: isRunning
                    ? `${meta.color}22`
                    : isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)",
                  justifyContent: "center", alignItems: "center",
                }}
              >
                {isRunning
                  ? <ActivityIndicator size="small" color={meta.color} style={{ width: 14, height: 14 }} />
                  : <IconSymbol name={meta.icon as any} size={10} color={meta.color} />
                }
              </View>
            );
          })}

          {hiddenCount > 0 && (
            <View
              style={{
                paddingHorizontal: 5, paddingVertical: 2,
                backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                borderRadius: 6,
              }}
            >
              <Text style={{ color: dotColor, fontSize: 10, fontWeight: "600" }}>
                +{hiddenCount}
              </Text>
            </View>
          )}

          {hasBadges && (
            <IconSymbol
              name={expanded ? "chevron.up" : "chevron.down"}
              size={9}
              color={dotColor}
            />
          )}
        </View>
      </TouchableBounce>

      {/* ── Expanded step list ────────────────────────────── */}
      {expanded && hasBadges && (
        <View
          style={{
            backgroundColor: bubbleBg,
            borderRadius: BORDER_RADIUS.lg,
            borderWidth: 1,
            borderColor: bubbleBorder,
            paddingHorizontal: 12,
            paddingVertical: 8,
            gap: 6,
            ...SHADOW.sm,
          }}
        >
          {toolSteps.map((step) => {
            const meta      = TOOL_META[step.tool] ?? TOOL_META.unknown;
            const isRunning = step.status === "running";
            const isError   = step.status === "error";
            const rowColor  = isRunning ? meta.color
              : isError ? "#EF4444"
              : isDark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.28)";
            return (
              <View key={step.id} style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                {isRunning
                  ? <ActivityIndicator size="small" color={meta.color} style={{ width: 14, height: 14 }} />
                  : isError
                    ? <IconSymbol name="xmark.circle.fill" size={12} color="#EF4444" />
                    : <IconSymbol name="checkmark.circle.fill" size={12} color="#22C55E" />
                }
                <View style={{
                  width: 20, height: 20, borderRadius: 5,
                  backgroundColor: isRunning ? `${meta.color}20` : (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"),
                  justifyContent: "center", alignItems: "center",
                }}>
                  <IconSymbol name={meta.icon as any} size={11} color={isRunning ? meta.color : rowColor} />
                </View>
                <Text
                  style={{
                    color: isRunning ? AC.label : (isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.38)"),
                    fontSize: 12.5,
                    fontWeight: isRunning ? "500" : "400",
                    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                    flexShrink: 1,
                  }}
                  numberOfLines={1}
                >
                  {step.label}
                </Text>
              </View>
            );
          })}
        </View>
      )}


      {/* ── Live thinking content (expandable) ─────────────── */}
      {thinkingExpanded && hasThinking && (
        <View
          style={{
            backgroundColor: isDark ? "rgba(20,184,166,0.06)" : "rgba(20,184,166,0.04)",
            borderRadius: BORDER_RADIUS.lg,
            borderWidth: 1,
            borderColor: isDark ? "rgba(20,184,166,0.18)" : "rgba(20,184,166,0.12)",
            paddingHorizontal: 12,
            paddingVertical: 10,
            maxHeight: 200,
          }}
        >
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text
              style={{
                color: isDark ? "rgba(255,255,255,0.50)" : "rgba(0,0,0,0.45)",
                fontSize: 12,
                lineHeight: 18,
                fontStyle: "italic",
              }}
            >
              {thinkingContent}
            </Text>
          </ScrollView>
        </View>
      )}

      {/* ── Permission request cards ───────────────────────── */}
      {permissionRequests.map((req) => {
        const meta = TOOL_META[req.tool] ?? TOOL_META.unknown;
        return (
          <View
            key={req.id}
            style={{
              backgroundColor: bubbleBg,
              borderRadius: BORDER_RADIUS.lg,
              borderWidth: 1.5,
              borderColor: AC.systemOrange,
              overflow: "hidden",
              ...SHADOW.sm,
            }}
          >
            {/* Orange header strip */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 7,
                backgroundColor: isDark ? "rgba(255,149,0,0.15)" : "rgba(255,149,0,0.10)",
                paddingHorizontal: 14,
                paddingVertical: 9,
              }}
            >
              <View
                style={{
                  width: 24, height: 24, borderRadius: 7,
                  backgroundColor: "rgba(255,149,0,0.20)",
                  justifyContent: "center", alignItems: "center",
                }}
              >
                <IconSymbol name={meta.icon as any} size={13} color={AC.systemOrange} />
              </View>
              <Text style={{ color: AC.systemOrange, fontSize: 13, fontWeight: "700", flex: 1 }}>
                Permission Required
              </Text>
              <IconSymbol name="exclamationmark.triangle.fill" size={13} color={AC.systemOrange} />
            </View>

            {/* Description + buttons */}
            <View style={{ padding: 14, gap: 12 }}>
              <Text
                style={{
                  color: AC.label,
                  fontSize: 13,
                  lineHeight: 18,
                  fontFamily: req.tool === "bash" ? (Platform.OS === "ios" ? "Menlo" : "monospace") : undefined,
                }}
              >
                {req.description}
              </Text>
              <View style={{ flexDirection: "row", gap: SPACING.sm }}>
                <TouchableBounce sensory onPress={() => onApprove(req.id)} style={{ flex: 1 }}>
                  <View
                    style={{
                      backgroundColor: AC.systemBlue,
                      borderRadius: BORDER_RADIUS.md,
                      paddingVertical: 9,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>Allow</Text>
                  </View>
                </TouchableBounce>
                <TouchableBounce sensory onPress={() => onDeny(req.id)} style={{ flex: 1 }}>
                  <View
                    style={{
                      backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                      borderRadius: BORDER_RADIUS.md,
                      paddingVertical: 9,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: AC.label, fontSize: 14, fontWeight: "600" }}>Deny</Text>
                  </View>
                </TouchableBounce>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
