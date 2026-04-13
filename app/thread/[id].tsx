import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams } from "expo-router";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import * as AC from "@bacons/apple-colors";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { IconSymbol } from "@/components/ui/IconSymbol";
import SlashCommandPicker from "@/components/SlashCommandPicker";
import { useGatewayStore } from "@/store/gatewayStore";
import type { Message, ToolStep, PermissionRequest, ThreadStatus } from "@/store/gatewayStore";
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
  const actions = useGatewayStore((s) => s.actions);
  const thread = useGatewayStore((s) =>
    s.threads.find((t) => t.id === id)
  );
  const messageMap = useGatewayStore((s) => s.messages);
  const terminalMap = useGatewayStore((s) => s.terminal);
  const toolSteps = useGatewayStore((s) => s.toolSteps[id ?? ""] ?? EMPTY_STEPS);
  const rawPermReqs = useGatewayStore((s) => s.permissionRequests[id ?? ""] ?? EMPTY_REQS);
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
  const terminalRef = useRef<BottomSheetModal>(null);
  const { bottom } = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  useEffect(() => {
    if (!id) return;
    actions.setActiveThread(id);
    actions.loadMessages(id).catch(() => {});
    actions.loadTerminal(id).catch(() => {});
    actions.openStream(id);
    return () => actions.closeStream(id);
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

  const send = async () => {
    if (!id || !input.trim()) return;
    const msg = input.trim();
    // Clear immediately — don't wait for claw to finish (HTTP POST blocks until done)
    setInput("");
    setSlashPickerVisible(false);
    setSending(true);
    try {
      await actions.sendMessage(id, msg);
    } catch {
      // error handled in store
    } finally {
      setSending(false);
    }
  };

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

  const threadStatus = thread?.status ?? "idle";

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


  const listFooterElem = useMemo(() => {
    // Show the bouncing-dot bubble only while waiting for the first assistant
    // delta. Once the last message is from the assistant, the streaming bubble
    // is visible and we don't want the indicator stacking below it.
    // Always show for "waiting" status so permission prompts render.
    const lastMsg = messages[messages.length - 1];
    const needsIndicator =
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
      />
    ) : null;
  }, [threadStatus, messages, toolSteps, permissionReqs, actions, id, isDark]);

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
      <Stack.Screen
        options={{
          headerTitle: () => {
            const dirName = thread.workDir
              ? thread.workDir.split("/").filter(Boolean).pop()
              : null;
            return (
              <View style={{ alignItems: "center" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ color: AC.label, fontSize: 15, fontWeight: "600" }} numberOfLines={1}>
                    {thread.title}
                  </Text>
                </View>
                {dirName ? (
                  <Text style={{ color: AC.systemGray, fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", marginTop: 1 }} numberOfLines={1}>
                    {dirName}
                  </Text>
                ) : null}
              </View>
            );
          },
          headerRight: () => headerRight,
        }}
      />
      <View
        style={{
          flex: 1,
          paddingBottom: bottom,
        }}
      >
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
          renderItem={({ item }) => <MessageBubble message={item} />}
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

        {/* Input bar - clean, minimal */}
        <View
          style={{
            paddingHorizontal: SPACING.lg,
            paddingTop: SPACING.sm,
            paddingBottom: SPACING.sm,
            gap: SPACING.sm,
          }}
        >
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
              disabled={!input.trim() || sending}
              onPress={send}
              style={{
                opacity: !input.trim() || sending ? 0.3 : 1,
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

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  const onCopy = useCallback(async () => {
    await Clipboard.setStringAsync(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [message.content]);

  return (
    <View
      style={{
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: 4,
      }}
    >
      <TouchableBounce sensory onPress={onCopy}>
        <View
          style={{
            maxWidth: "80%",
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
            ...(isUser
              ? SHADOW.md
              : SHADOW.sm),
          }}
        >
          <Text
            style={{
              color: isUser ? "#fff" : AC.label,
              fontSize: TYPOGRAPHY.fontSizes.md,
              lineHeight: TYPOGRAPHY.lineHeights.md,
            }}
          >
            {message.content}
          </Text>
        </View>
      </TouchableBounce>

      {/* Subtle copy indicator on long press — shown inline as tiny action */}
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

/** Icon mapping for tool step types */
const TOOL_ICONS: Record<string, string> = {
  bash: "terminal",
  edit: "pencil",
  read: "doc.text",
  write: "square.and.pencil",
  search: "magnifyingglass",
  think: "brain.head.profile",
  grep: "magnifyingglass",
  glob: "folder",
};

/** iMessage-style three bouncing dots */
function BouncingDots({ color }: { color: string }) {
  const d1 = useRef(new Animated.Value(0)).current;
  const d2 = useRef(new Animated.Value(0)).current;
  const d3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Animated.delay is NOT compatible with useNativeDriver:true — use setTimeout
    // to stagger each dot's independent loop instead.
    const makeBounce = (val: Animated.Value) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: -5, duration: 260, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0,  duration: 260, useNativeDriver: true }),
        ])
      );

    const anim1 = makeBounce(d1);
    anim1.start();

    const animRefs: Animated.CompositeAnimation[] = [anim1];
    const t1 = setTimeout(() => { const a = makeBounce(d2); a.start(); animRefs.push(a); }, 150);
    const t2 = setTimeout(() => { const a = makeBounce(d3); a.start(); animRefs.push(a); }, 300);

    return () => {
      animRefs.forEach((a) => a.stop());
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const dot = (val: Animated.Value) => (
    <Animated.View
      style={{
        width: 7, height: 7, borderRadius: 3.5,
        backgroundColor: color,
        transform: [{ translateY: val }],
      }}
    />
  );
  return (
    <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
      {dot(d1)}{dot(d2)}{dot(d3)}
    </View>
  );
}

function ThinkingIndicator({
  status,
  toolSteps,
  permissionRequests,
  onApprove,
  onDeny,
  isDark,
}: {
  status: ThreadStatus;
  toolSteps: ToolStep[];
  permissionRequests: PermissionRequest[];
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  isDark: boolean;
}) {
  const latestRunning = toolSteps.filter((s) => s.status === "running");
  const recentDone = toolSteps.filter((s) => s.status === "done").slice(-3);
  const isWaiting = status === "waiting";
  const dotColor = isWaiting
    ? AC.systemOrange
    : (isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.35)");

  return (
    <View style={{ gap: SPACING.sm, paddingTop: SPACING.xs }}>
      {/* Main indicator: assistant bubble with bouncing dots */}
      <View
        style={{
          alignSelf: "flex-start",
          backgroundColor: isDark ? "#1c1c1e" : "#fff",
          borderRadius: BORDER_RADIUS.xl,
          borderBottomLeftRadius: SPACING.xs,
          borderWidth: 1,
          borderColor: isWaiting
            ? AC.systemOrange
            : (isDark ? "rgba(255,255,255,0.06)" : AC.separator),
          paddingHorizontal: 14,
          paddingVertical: 12,
          ...SHADOW.sm,
        }}
      >
        {isWaiting ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ActivityIndicator size="small" color={AC.systemOrange} />
            <Text style={{ color: AC.systemOrange, fontSize: 13, fontWeight: "500" }}>
              Waiting for approval…
            </Text>
          </View>
        ) : (
          <BouncingDots color={dotColor} />
        )}
      </View>

      {/* Active tool steps */}
      {latestRunning.length > 0 && (
        <View style={{ gap: 4, paddingLeft: SPACING.xs }}>
          {latestRunning.map((step) => (
            <View
              key={step.id}
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <ActivityIndicator size="small" color={AC.systemBlue} />
              <IconSymbol
                name={TOOL_ICONS[step.tool] ?? "hammer"}
                size={11}
                color={AC.systemGray}
              />
              <Text
                style={{
                  color: AC.systemGray,
                  fontSize: 12,
                  fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                }}
                numberOfLines={1}
              >
                {step.label}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Recently completed steps — subtle checkmarks */}
      {recentDone.length > 0 && (
        <View style={{ gap: 2, paddingLeft: SPACING.xs }}>
          {recentDone.map((step) => (
            <View
              key={step.id}
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <IconSymbol name="checkmark" size={10} color={AC.systemGreen} />
              <Text
                style={{
                  color: AC.systemGray3,
                  fontSize: 11,
                }}
                numberOfLines={1}
              >
                {step.label}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Permission prompts — inline approval cards */}
      {permissionRequests.length > 0 && (
        <View style={{ gap: SPACING.sm }}>
          {permissionRequests.map((req) => (
            <View
              key={req.id}
              style={{
                backgroundColor: isDark ? "#1c1c1e" : "#fff",
                borderRadius: BORDER_RADIUS.lg,
                borderWidth: 1,
                borderColor: status === "waiting"
                  ? AC.systemOrange
                  : isDark
                    ? "rgba(255,255,255,0.08)"
                    : AC.separator,
                padding: SPACING.md,
                gap: SPACING.sm,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <IconSymbol
                  name={TOOL_ICONS[req.tool] ?? "exclamationmark.shield"}
                  size={14}
                  color={AC.systemOrange}
                />
                <Text style={{ color: AC.label, fontSize: 13, fontWeight: "600" }}>
                  Permission Required
                </Text>
              </View>
              <Text
                style={{
                  color: AC.secondaryLabel,
                  fontSize: 13,
                  lineHeight: 18,
                }}
              >
                {req.description}
              </Text>
              <View style={{ flexDirection: "row", gap: SPACING.sm }}>
                <TouchableBounce
                  sensory
                  onPress={() => onApprove(req.id)}
                >
                  <View
                    style={{
                      backgroundColor: AC.systemBlue,
                      borderRadius: BORDER_RADIUS.md,
                      paddingHorizontal: SPACING.lg,
                      paddingVertical: SPACING.sm,
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>
                      Allow
                    </Text>
                  </View>
                </TouchableBounce>
                <TouchableBounce
                  sensory
                  onPress={() => onDeny(req.id)}
                >
                  <View
                    style={{
                      backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                      borderRadius: BORDER_RADIUS.md,
                      paddingHorizontal: SPACING.lg,
                      paddingVertical: SPACING.sm,
                    }}
                  >
                    <Text style={{ color: AC.label, fontSize: 13, fontWeight: "600" }}>
                      Deny
                    </Text>
                  </View>
                </TouchableBounce>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
