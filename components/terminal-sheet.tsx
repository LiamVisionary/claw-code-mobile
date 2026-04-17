import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { useGatewayStore } from "@/store/gatewayStore";
import { usePalette } from "@/hooks/usePalette";
import { IconSymbol } from "@/components/ui/IconSymbol";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { BORDER_RADIUS, SPACING, TYPOGRAPHY } from "@/constants/theme";
import { parseAnsi } from "./ansi";

const EMPTY_LINES: string[] = [];

type Props = {
  threadId: string;
  visible: boolean;
  onClose: () => void;
  onSendToClaw: (text: string) => void;
};

export default function TerminalSheet({ threadId, visible, onClose, onSendToClaw }: Props) {
  const actions = useGatewayStore((s) => s.actions);
  const thread = useGatewayStore((s) => s.threads.find((t) => t.id === threadId));
  const lines = useGatewayStore((s) => s.terminal[threadId] ?? EMPTY_LINES);
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  const [command, setCommand] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const slideAnim = useRef(new Animated.Value(800)).current;
  const lastOutputAtRef = useRef(0);
  const [isRunning, setIsRunning] = useState(false);

  // Track "command in flight" via the last time a new line arrived. When
  // output stops flowing for 2s we assume the command has finished.
  const prevLineCountRef = useRef(lines.length);
  useEffect(() => {
    if (lines.length > prevLineCountRef.current) {
      lastOutputAtRef.current = Date.now();
      setIsRunning(true);
    }
    prevLineCountRef.current = lines.length;
  }, [lines.length]);
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => {
      if (Date.now() - lastOutputAtRef.current > 2000) setIsRunning(false);
    }, 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  useEffect(() => {
    if (visible) {
      actions.loadTerminal(threadId).catch(() => {});
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 60,
        friction: 12,
      }).start();
    } else {
      slideAnim.setValue(800);
    }
  }, [visible, threadId, actions, slideAnim]);

  useEffect(() => {
    if (!visible) return;
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => setKeyboardHeight(e.endCoordinates.height)
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardHeight(0)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [visible]);

  const send = useCallback(async () => {
    const trimmed = command.trim();
    if (!trimmed) return;
    setCommand("");
    try {
      await actions.sendTerminalCommand(threadId, trimmed);
    } catch {
      /* errors surface as terminal output via SSE or next load */
    }
  }, [command, threadId, actions]);

  const stop = useCallback(async () => {
    try {
      await actions.interruptTerminal(threadId);
    } catch {
      /* noop */
    }
  }, [threadId, actions]);

  const killShell = useCallback(async () => {
    try {
      await actions.killTerminal(threadId);
    } catch {
      /* noop */
    }
  }, [threadId, actions]);

  const sendToClaw = useCallback(async () => {
    try {
      const snap = await actions.snapshotTerminal(threadId);
      if (snap.length === 0) return;
      const block = "```\n" + snap.join("\n") + "\n```";
      onSendToClaw(block);
      onClose();
    } catch {
      /* noop */
    }
  }, [threadId, actions, onSendToClaw, onClose]);

  const cwd = thread?.workDir || "";
  const cwdLabel = useMemo(() => {
    if (!cwd) return "no workdir";
    const parts = cwd.split("/");
    return parts.length > 3 ? ".../" + parts.slice(-2).join("/") : cwd;
  }, [cwd]);

  // Render the list inverted so new lines stick to the bottom without
  // scroll-math. The data prop gets reversed for this to work.
  const reversedLines = useMemo(() => lines.slice().reverse(), [lines]);

  const listBg = isDark ? "#0B0B0D" : "#1B1D21";
  const listFg = "#E4E6EB";

  return (
    <Modal
      transparent
      animationType="none"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <Pressable
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={onClose}
        />
        <Animated.View
          style={{
            backgroundColor: palette.bg,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            height: "88%",
            transform: [{ translateY: slideAnim }],
            overflow: "hidden",
          }}
        >
          {/* Grabber */}
          <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 6 }}>
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: palette.divider,
              }}
            />
          </View>

          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: SPACING.lg,
              paddingBottom: SPACING.sm,
              gap: SPACING.sm,
            }}
          >
            <IconSymbol name="terminal" size={18} color={palette.text} />
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                color: palette.textMuted,
                fontSize: TYPOGRAPHY.fontSizes.sm,
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              }}
            >
              {cwdLabel}
            </Text>
            <TouchableBounce sensory onPress={killShell}>
              <View
                style={{
                  paddingHorizontal: SPACING.sm,
                  paddingVertical: SPACING.xs,
                  borderRadius: BORDER_RADIUS.sm,
                  backgroundColor: palette.surface,
                }}
              >
                <Text style={{ color: palette.danger, fontSize: TYPOGRAPHY.fontSizes.xs, fontWeight: "600" }}>
                  Kill shell
                </Text>
              </View>
            </TouchableBounce>
            <TouchableBounce sensory onPress={onClose}>
              <IconSymbol name="xmark.circle.fill" size={22} color={palette.textSoft} />
            </TouchableBounce>
          </View>

          {/* Output */}
          <View
            style={{
              flex: 1,
              backgroundColor: listBg,
              marginHorizontal: SPACING.md,
              borderRadius: BORDER_RADIUS.md,
              overflow: "hidden",
            }}
          >
            {lines.length === 0 ? (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.lg }}>
                <Text style={{ color: "#777", fontSize: TYPOGRAPHY.fontSizes.sm }}>
                  Type a command below to start a shell in {cwdLabel}.
                </Text>
              </View>
            ) : (
              <FlatList
                data={reversedLines}
                inverted
                keyExtractor={(_, i) => String(lines.length - 1 - i)}
                renderItem={({ item }) => <AnsiLine line={item} color={listFg} />}
                contentContainerStyle={{ paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md }}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={40}
                maxToRenderPerBatch={60}
                windowSize={8}
              />
            )}
          </View>

          {/* Action row (send-to-Claw / stop) */}
          <View
            style={{
              flexDirection: "row",
              gap: SPACING.sm,
              paddingHorizontal: SPACING.md,
              paddingTop: SPACING.sm,
            }}
          >
            <TouchableBounce sensory onPress={sendToClaw} style={{ flex: 1 }}>
              <View
                style={{
                  paddingVertical: SPACING.sm,
                  borderRadius: BORDER_RADIUS.md,
                  backgroundColor: palette.surface,
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <IconSymbol name="arrow.up" size={14} color={palette.text} />
                <Text style={{ color: palette.text, fontSize: TYPOGRAPHY.fontSizes.sm, fontWeight: "600" }}>
                  Send last output to Claw
                </Text>
              </View>
            </TouchableBounce>
            {isRunning && (
              <TouchableBounce sensory onPress={stop}>
                <View
                  style={{
                    paddingHorizontal: SPACING.md,
                    paddingVertical: SPACING.sm,
                    borderRadius: BORDER_RADIUS.md,
                    backgroundColor: palette.danger,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#fff", fontSize: TYPOGRAPHY.fontSizes.sm, fontWeight: "700" }}>
                    Stop
                  </Text>
                </View>
              </TouchableBounce>
            )}
          </View>

          {/* Command input */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: SPACING.sm,
              paddingHorizontal: SPACING.md,
              paddingTop: SPACING.sm,
              paddingBottom: (keyboardHeight > 0 ? 8 : 24) + (Platform.OS === "ios" ? 0 : 8),
              marginBottom: keyboardHeight,
            }}
          >
            <View
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: palette.surface,
                borderRadius: BORDER_RADIUS.md,
                paddingHorizontal: SPACING.md,
                paddingVertical: 4,
                borderWidth: 1,
                borderColor: palette.divider,
              }}
            >
              <Text
                style={{
                  color: palette.textMuted,
                  fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                  fontSize: TYPOGRAPHY.fontSizes.sm,
                  marginRight: 6,
                }}
              >
                $
              </Text>
              <TextInput
                value={command}
                onChangeText={setCommand}
                placeholder="ls, npm install, git status…"
                placeholderTextColor={palette.textSoft}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                keyboardAppearance={isDark ? "dark" : "light"}
                onSubmitEditing={send}
                returnKeyType="send"
                blurOnSubmit={false}
                multiline
                style={{
                  flex: 1,
                  color: palette.text,
                  fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                  fontSize: TYPOGRAPHY.fontSizes.sm,
                  minHeight: 36,
                  maxHeight: 120,
                  paddingVertical: 8,
                }}
              />
            </View>
            <TouchableBounce
              sensory
              disabled={!command.trim()}
              onPress={send}
              style={{ opacity: command.trim() ? 1 : 0.3, marginBottom: 4 }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: command.trim() ? palette.text : palette.surface,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <IconSymbol name="arrow.up" size={16} color={command.trim() ? palette.bg : palette.textSoft} />
              </View>
            </TouchableBounce>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function AnsiLine({ line, color }: { line: string; color: string }) {
  const segments = useMemo(() => parseAnsi(line), [line]);
  if (segments.length === 0) {
    return (
      <Text
        style={{
          color,
          fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
          fontSize: TYPOGRAPHY.fontSizes.xs,
          lineHeight: 17,
        }}
        selectable
      >
        {" "}
      </Text>
    );
  }
  return (
    <Text
      style={{
        fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
        fontSize: TYPOGRAPHY.fontSizes.xs,
        lineHeight: 17,
      }}
      selectable
    >
      {segments.map((seg, i) => (
        <Text
          key={i}
          style={{
            color: seg.style.color ?? color,
            backgroundColor: seg.style.backgroundColor,
            fontWeight: seg.style.fontWeight,
            fontStyle: seg.style.fontStyle,
            textDecorationLine: seg.style.textDecorationLine,
            opacity: seg.style.opacity,
          }}
        >
          {seg.text}
        </Text>
      ))}
    </Text>
  );
}
