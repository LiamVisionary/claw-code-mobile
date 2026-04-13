import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
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
      <View style={{ flexDirection: "row", gap: 12 }}>
        {threadStatus === "running" && (
          <TouchableBounce sensory onPress={onStop}>
            <View
              style={{
                padding: 8,
                backgroundColor: AC.systemRed,
                borderRadius: 12,
              }}
            >
              <IconSymbol name="stop.fill" color={AC.systemBackground} />
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
              padding: 8,
              backgroundColor: AC.secondarySystemGroupedBackground,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: AC.separator,
            }}
          >
            <IconSymbol name="terminal" color={AC.label} />
          </View>
        </TouchableBounce>
      </View>
    ),
    [threadStatus, id, actions, onStop]
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
                <Text style={{ color: AC.label, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>
                  {thread.title}
                </Text>
                {dirName ? (
                  <Text style={{ color: AC.systemGray, fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }} numberOfLines={1}>
                    📁 {dirName}
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
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: bottom + 12,
          gap: 12,
          flex: 1,
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: AC.secondarySystemGroupedBackground,
            borderRadius: 18,
            borderColor: AC.separator,
            borderWidth: 1,
            overflow: "hidden",
          }}
        >
          {threadStatus === "running" && (
            <View
              style={{
                padding: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                borderBottomWidth: 1,
                borderBottomColor: AC.separator,
              }}
            >
              <ActivityIndicator />
              <Text style={{ color: AC.label }}>Assistant is running…</Text>
            </View>
          )}
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16, gap: 12 }}
            renderItem={({ item }) => <MessageBubble message={item} />}
            ListEmptyComponent={() => (
              <View
                style={{
                  paddingVertical: 32,
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <IconSymbol
                  name="ellipsis.bubble"
                  color={AC.systemGray2}
                  size={28}
                />
                <Text style={{ color: AC.systemGray }}>
                  No messages yet. Say hi!
                </Text>
              </View>
            )}
          />
        </View>

        <View
          style={{
            backgroundColor: AC.secondarySystemGroupedBackground,
            borderRadius: 16,
            padding: 12,
            borderColor: AC.separator,
            borderWidth: 1,
            gap: 8,
          }}
        >
          <TextInput
            placeholder="Send a message to your Claw agent"
            placeholderTextColor={AC.systemGray}
            value={input}
            onChangeText={setInput}
            multiline
            style={{
              minHeight: 48,
              maxHeight: 140,
              color: AC.label,
              padding: 12,
              backgroundColor: AC.systemBackground,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: AC.separator,
            }}
          />
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableBounce
                sensory
                onPress={() => terminalRef.current?.present()}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: AC.systemGroupedBackground,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: AC.separator,
                  }}
                >
                  <IconSymbol name="chevron.up" color={AC.label} />
                  <Text style={{ color: AC.label }}>Terminal</Text>
                </View>
              </TouchableBounce>

              <TouchableBounce
                sensory
                disabled={!messages.length}
                onPress={copyConversation}
                style={{ opacity: messages.length ? 1 : 0.4 }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: copiedConvo
                      ? AC.systemGreen
                      : AC.systemGroupedBackground,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: copiedConvo ? AC.systemGreen : AC.separator,
                  }}
                >
                  <IconSymbol
                    name={copiedConvo ? "checkmark" : "doc.on.doc"}
                    color={copiedConvo ? AC.systemBackground : AC.label}
                    size={14}
                  />
                  <Text
                    style={{
                      color: copiedConvo ? AC.systemBackground : AC.label,
                      fontSize: 14,
                    }}
                  >
                    {copiedConvo ? "Copied!" : "Copy"}
                  </Text>
                </View>
              </TouchableBounce>
            </View>

            <TouchableBounce
              sensory
              disabled={!input.trim() || sending}
              onPress={send}
              style={{ opacity: !input.trim() || sending ? 0.6 : 1 }}
            >
              <View
                style={{
                  backgroundColor: AC.label,
                  paddingHorizontal: 18,
                  paddingVertical: 12,
                  borderRadius: 14,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <IconSymbol name="arrow.up" color={AC.systemBackground} />
                <Text style={{ color: AC.systemBackground, fontWeight: "600" }}>
                  Send
                </Text>
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
        <View style={{ flex: 1, padding: 12, gap: 12 }}>
          <Text style={{ color: AC.label, fontWeight: "600" }}>
            Terminal
          </Text>
          <View
            style={{
              flex: 1,
              backgroundColor: "#0f0f0f",
              borderRadius: 12,
              padding: 12,
              gap: 6,
            }}
          >
            <FlatList
              data={terminalLines}
              keyExtractor={(_, index) => `${index}`}
              renderItem={({ item }) => (
                <Text
                  style={{
                    color: "#c8f8c8",
                    fontFamily: Platform.select({
                      ios: "Menlo",
                      android: "monospace",
                      default: "monospace",
                    }),
                  }}
                >
                  {item}
                </Text>
              )}
            />
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              value={command}
              onChangeText={setCommand}
              placeholder="Run a command"
              placeholderTextColor={AC.systemGray2}
              style={{
                flex: 1,
                backgroundColor: AC.secondarySystemGroupedBackground,
                borderRadius: 10,
                paddingHorizontal: 12,
                borderWidth: 1,
                borderColor: AC.separator,
                color: AC.label,
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
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  backgroundColor: AC.label,
                  borderRadius: 12,
                  opacity: command.trim() ? 1 : 0.6,
                }}
              >
                <Text style={{ color: AC.systemBackground }}>Send</Text>
              </View>
            </TouchableBounce>
          </View>
        </View>
      </BottomSheetModal>
    </KeyboardAvoidingView>
  );
}

const BORDER_RADIUS = { sm: 8, md: 12, lg: 18 };
const SPACING = { xs: 4, sm: 8, md: 12, lg: 16 };
const SHADOW = {
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
};
const TYPOGRAPHY = {
  fontSizes: { xs: 12, sm: 13, md: 15, lg: 17 },
  lineHeights: { xs: 16, sm: 18, md: 22, lg: 26 },
};

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

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
        gap: 6,
      }}
    >
      <View
        style={{
          maxWidth: "82%",
          backgroundColor: isUser ? AC.systemGray6 : AC.systemGroupedBackground,
          borderRadius: BORDER_RADIUS.lg,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.md,
          borderWidth: isUser ? 0 : 1,
          borderColor: isUser ? AC.label : AC.separator,
          ...(isUser ? SHADOW.md : {}),
        }}
      >
        <Text style={{ color: isUser ? AC.systemBackground : AC.label, fontSize: TYPOGRAPHY.fontSizes.md, lineHeight: TYPOGRAPHY.lineHeights.md }}>
          {message.content}
        </Text>
      </View>

      <TouchableBounce sensory onPress={onCopy}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: SPACING.sm,
            paddingHorizontal: SPACING.sm,
            paddingVertical: SPACING.xs,
            borderRadius: BORDER_RADIUS.sm,
            backgroundColor: copied
              ? AC.systemGreen
              : AC.tertiarySystemGroupedBackground,
          }}
        >
          <IconSymbol
            name={copied ? "checkmark" : "doc.on.doc"}
            size={TYPOGRAPHY.fontSizes.xs}
            color={copied ? AC.systemBackground : AC.systemGray}
          />
          <Text
            style={{
              fontSize: TYPOGRAPHY.fontSizes.xs,
              color: copied ? AC.systemBackground : AC.systemGray,
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Text>
        </View>
      </TouchableBounce>
    </View>
  );
}
