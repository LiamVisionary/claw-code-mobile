import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { useGatewayStore } from "@/store/gatewayStore";
import { usePalette } from "@/hooks/usePalette";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { SPACING, TYPOGRAPHY } from "@/constants/theme";
import { parseAnsi } from "./ansi";

const EMPTY_LINES: string[] = [];
const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";
const TERMINAL_BG = "#0B0B0D";
const TERMINAL_FG = "#E4E6EB";
const PROMPT_COLOR = "#6ED88F";
const CWD_COLOR = "#79B8FF";
const DIM_COLOR = "#8E8E93";

type Props = {
  threadId: string;
  visible: boolean;
  onClose: () => void;
  onSendToClaw: (text: string) => void;
};

function shortenCwd(cwd: string): string {
  if (!cwd) return "~";
  const home = process.env.HOME ?? "";
  const withHome = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
  const parts = withHome.split("/").filter(Boolean);
  if (parts.length <= 2) return withHome;
  return ".../" + parts.slice(-2).join("/");
}

export default function TerminalSheet({ threadId, visible, onClose, onSendToClaw }: Props) {
  const actions = useGatewayStore((s) => s.actions);
  const lines = useGatewayStore((s) => s.terminal[threadId] ?? EMPTY_LINES);
  const cwd = useGatewayStore((s) => s.terminalCwd[threadId] ?? "");
  const busy = useGatewayStore((s) => s.terminalBusy[threadId] ?? false);
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  const [command, setCommand] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const slideAnim = useRef(new Animated.Value(1000)).current;
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  // ── Slide in / out ─────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      actions.loadTerminal(threadId).catch(() => {});
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 12,
      }).start();
      // Delay so the modal has mounted before trying to focus.
      const t = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(t);
    } else {
      slideAnim.setValue(1000);
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

  // Auto-stick to bottom when new lines arrive.
  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [lines.length, visible]);

  // ── Drag-to-dismiss on the grabber area ────────────────────────
  const dragY = useRef(new Animated.Value(0)).current;
  const dismiss = useCallback(() => {
    Keyboard.dismiss();
    Animated.timing(slideAnim, {
      toValue: 1000,
      duration: 180,
      useNativeDriver: true,
    }).start(() => onClose());
  }, [slideAnim, onClose]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 5 && g.dy > 0,
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) dragY.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 120 || g.vy > 0.8) {
          Animated.timing(dragY, {
            toValue: 1000,
            duration: 150,
            useNativeDriver: true,
          }).start(() => {
            dragY.setValue(0);
            onClose();
          });
        } else {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 80,
            friction: 10,
          }).start();
        }
      },
    })
  ).current;

  // ── Actions ─────────────────────────────────────────────────────
  const send = useCallback(() => {
    const trimmed = command.trim();
    if (!trimmed) return;
    setCommand("");
    actions.sendTerminalCommand(threadId, trimmed).catch(() => {});
  }, [command, threadId, actions]);

  const stop = useCallback(() => {
    actions.interruptTerminal(threadId).catch(() => {});
  }, [threadId, actions]);

  const sendToClaw = useCallback(async () => {
    let snap: string[] = [];
    try {
      snap = await actions.snapshotTerminal(threadId);
    } catch {
      /* fall through */
    }
    // Fall back to the visible history — if the user opens the sheet
    // from an old session where the in-memory buffer was reset, the
    // snapshot will be empty but the SQLite-backed lines are still
    // there.
    if (snap.length === 0) {
      snap = lines.slice(-200);
    }
    if (snap.length === 0) return;
    const block = "```\n" + snap.join("\n") + "\n```";
    onSendToClaw(block);
    dismiss();
  }, [threadId, actions, lines, onSendToClaw, dismiss]);

  const cwdLabel = useMemo(() => shortenCwd(cwd), [cwd]);

  // ── Render ─────────────────────────────────────────────────────
  return (
    <Modal
      transparent
      animationType="none"
      visible={visible}
      onRequestClose={dismiss}
    >
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <Pressable
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={dismiss}
        />
        <Animated.View
          style={{
            backgroundColor: TERMINAL_BG,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            height: "88%",
            transform: [{ translateY: Animated.add(slideAnim, dragY) }],
            overflow: "hidden",
          }}
        >
          {/* Drag handle (whole top strip is pan-responsive) */}
          <View
            {...panResponder.panHandlers}
            style={{ alignItems: "center", paddingTop: 10, paddingBottom: 8 }}
          >
            <View
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: "rgba(255,255,255,0.25)",
              }}
            />
          </View>

          {/* Tiny status strip — cwd only, no buttons */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: SPACING.lg,
              paddingBottom: 4,
              gap: SPACING.sm,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                color: DIM_COLOR,
                fontFamily: MONO,
                fontSize: TYPOGRAPHY.fontSizes.xs,
              }}
            >
              {cwdLabel}
            </Text>
            {busy && (
              <TouchableBounce sensory onPress={stop}>
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                    borderRadius: 10,
                    backgroundColor: "rgba(255, 59, 48, 0.18)",
                  }}
                >
                  <Text
                    style={{
                      color: "#FF6B5E",
                      fontSize: TYPOGRAPHY.fontSizes.xs,
                      fontWeight: "600",
                      fontFamily: MONO,
                    }}
                  >
                    ⌃C
                  </Text>
                </View>
              </TouchableBounce>
            )}
            <TouchableBounce sensory onPress={sendToClaw}>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 3,
                  borderRadius: 10,
                  backgroundColor: "rgba(255,255,255,0.08)",
                }}
              >
                <Text
                  style={{
                    color: TERMINAL_FG,
                    fontSize: TYPOGRAPHY.fontSizes.xs,
                    fontWeight: "600",
                  }}
                >
                  Send to Claw
                </Text>
              </View>
            </TouchableBounce>
          </View>

          {/* Output + prompt — tap anywhere to focus */}
          <Pressable
            onPress={() => inputRef.current?.focus()}
            style={{ flex: 1 }}
          >
            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingHorizontal: SPACING.md,
                paddingTop: SPACING.xs,
                paddingBottom: SPACING.md,
              }}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
            >
              {lines.length === 0 && (
                <Text
                  style={{
                    color: DIM_COLOR,
                    fontFamily: MONO,
                    fontSize: TYPOGRAPHY.fontSizes.xs,
                    lineHeight: 17,
                  }}
                >
                  {`Interactive shell at ${cwdLabel || "~"}.\nType a command and hit return.`}
                </Text>
              )}
              {lines.map((line, i) => (
                <AnsiLine key={i} line={line} />
              ))}
              {/* Live prompt line — continuous with the output */}
              <PromptLine
                cwd={cwdLabel}
                busy={busy}
                value={command}
                onChangeText={setCommand}
                onSubmit={send}
                inputRef={inputRef}
                isDark={isDark}
              />
            </ScrollView>
          </Pressable>

          {/* Bottom spacer that tracks the keyboard so the prompt doesn't
              hide under it. No visible input — the prompt line above IS
              the input. */}
          <View style={{ height: keyboardHeight > 0 ? keyboardHeight : Platform.OS === "ios" ? 28 : 8 }} />
        </Animated.View>
      </View>
    </Modal>
  );
}

function PromptLine({
  cwd,
  busy,
  value,
  onChangeText,
  onSubmit,
  inputRef,
  isDark,
}: {
  cwd: string;
  busy: boolean;
  value: string;
  onChangeText: (s: string) => void;
  onSubmit: () => void;
  inputRef: React.RefObject<TextInput | null>;
  isDark: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        marginTop: 2,
      }}
    >
      <Text
        style={{
          color: CWD_COLOR,
          fontFamily: MONO,
          fontSize: TYPOGRAPHY.fontSizes.xs,
          lineHeight: 20,
        }}
      >
        {cwd || "~"}
      </Text>
      <Text
        style={{
          color: PROMPT_COLOR,
          fontFamily: MONO,
          fontSize: TYPOGRAPHY.fontSizes.xs,
          lineHeight: 20,
          marginHorizontal: 6,
        }}
      >
        {busy ? "…" : "$"}
      </Text>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={busy ? "running…" : ""}
        placeholderTextColor={DIM_COLOR}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        keyboardAppearance={isDark ? "dark" : "light"}
        returnKeyType="send"
        blurOnSubmit={false}
        selectionColor={CWD_COLOR}
        style={{
          flex: 1,
          color: TERMINAL_FG,
          fontFamily: MONO,
          fontSize: TYPOGRAPHY.fontSizes.xs,
          lineHeight: 20,
          padding: 0,
          marginTop: Platform.OS === "ios" ? 0 : -4,
        }}
      />
    </View>
  );
}

function AnsiLine({ line }: { line: string }) {
  const segments = useMemo(() => parseAnsi(line), [line]);
  if (segments.length === 0) {
    return (
      <Text
        style={{
          color: TERMINAL_FG,
          fontFamily: MONO,
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
        fontFamily: MONO,
        fontSize: TYPOGRAPHY.fontSizes.xs,
        lineHeight: 17,
      }}
      selectable
    >
      {segments.map((seg, i) => (
        <Text
          key={i}
          style={{
            color: seg.style.color ?? TERMINAL_FG,
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
