import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { useGatewayStore } from "@/store/gatewayStore";
import type { Message } from "@/store/gatewayStore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BORDER_RADIUS, SPACING, SHADOW, TYPOGRAPHY } from "@/constants/theme";

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const actions = useGatewayStore((s) => s.actions);
  const thread = useGatewayStore((s) =>
    s.threads.find((t) => t.id === id)
  );
  const messageMap = useGatewayStore((s) => s.messages);
  const terminalMap = useGatewayStore((s) => s.terminal);
  const messages = messageMap[id ?? ""] ?? [];
  const terminalLines = terminalMap[id ?? ""] ?? [];
  const listRef = useRef<FlatList<Message>>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
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
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  const send = async () => {
    if (!id || !input.trim()) return;
    setSending(true);
    try {
      await actions.sendMessage(id, input.trim());
      setInput("");
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

  const statusColor = (() => {
    switch (threadStatus) {
      case "running":
        return AC.systemBlue;
      case "waiting":
        return AC.systemOrange;
      case "error":
        return AC.systemRed;
      default:
        return AC.systemGray2;
    }
  })();

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
                  {threadStatus === "running" && (
                    <View style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: AC.systemBlue,
                    }} />
                  )}
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
        {/* Status indicator - slim inline pill */}
        {threadStatus === "running" && (
          <View
            style={{
              marginHorizontal: SPACING.lg,
              marginTop: SPACING.sm,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: SPACING.md,
              paddingVertical: SPACING.xs,
              backgroundColor: isDark ? "rgba(10,132,255,0.12)" : "rgba(10,132,255,0.08)",
              borderRadius: BORDER_RADIUS.full,
              alignSelf: "flex-start",
            }}
          >
            <ActivityIndicator size="small" color={AC.systemBlue} />
            <Text style={{ color: AC.systemBlue, fontSize: 12, fontWeight: "500" }}>
              Thinking…
            </Text>
          </View>
        )}

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
              onChangeText={setInput}
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
