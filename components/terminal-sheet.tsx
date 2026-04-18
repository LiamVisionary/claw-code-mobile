import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { useGatewayStore } from "@/store/gatewayStore";
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
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  const [command, setCommand] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // Sticky modifiers — tap to arm, next keystroke consumes and un-arms.
  // Only one can be armed at a time for predictability.
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const [cmdArmed, setCmdArmed] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  // Command history (local to this sheet instance — not persisted).
  // historyIdx points at the entry currently surfaced; when equal to
  // history.length the input is a fresh draft.
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef<number>(0);
  const draftRef = useRef<string>("");

  useEffect(() => {
    if (!visible) return;
    actions.loadTerminal(threadId).catch(() => {});
    // Delay so the modal has mounted before trying to focus.
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [visible, threadId, actions]);

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

  const dismiss = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  // ── Actions ─────────────────────────────────────────────────────
  const send = useCallback(() => {
    const trimmed = command.trim();
    if (!trimmed) return;
    // Push to history, but dedupe consecutive duplicates the way bash does.
    const h = historyRef.current;
    if (h[h.length - 1] !== trimmed) h.push(trimmed);
    historyIdxRef.current = h.length;
    draftRef.current = "";
    setCommand("");
    actions.sendTerminalCommand(threadId, trimmed).catch(() => {});
  }, [command, threadId, actions]);

  const stop = useCallback(() => {
    actions.interruptTerminal(threadId).catch(() => {});
  }, [threadId, actions]);

  const historyUp = useCallback(() => {
    const h = historyRef.current;
    if (h.length === 0) return;
    // First ↑ stashes the current draft so ↓ back to "now" can restore it.
    if (historyIdxRef.current === h.length) {
      draftRef.current = command;
    }
    const next = Math.max(0, historyIdxRef.current - 1);
    historyIdxRef.current = next;
    setCommand(h[next] ?? "");
  }, [command]);

  const historyDown = useCallback(() => {
    const h = historyRef.current;
    if (h.length === 0) return;
    const next = historyIdxRef.current + 1;
    if (next >= h.length) {
      historyIdxRef.current = h.length;
      setCommand(draftRef.current);
    } else {
      historyIdxRef.current = next;
      setCommand(h[next] ?? "");
    }
  }, []);

  const clearLocalTerminal = useCallback(() => {
    useGatewayStore.setState((s) => ({
      terminal: { ...s.terminal, [threadId]: [] },
    }));
  }, [threadId]);

  const handleCtrlCombo = useCallback((rawChar: string) => {
    const c = rawChar.toLowerCase();
    if (c === "c") {
      actions.interruptTerminal(threadId).catch(() => {});
    } else if (c === "d") {
      // Non-PTY bash won't treat a 0x04 byte as EOF (stdin is a pipe, not
      // a terminal), so approximate Ctrl-D by running `exit` — closes the
      // shell the same way a user would.
      actions.sendTerminalCommand(threadId, "exit").catch(() => {});
    } else if (c === "l") {
      clearLocalTerminal();
    } else if (c >= "a" && c <= "z") {
      // Send the corresponding control byte (0x01..0x1A) raw to stdin.
      // Useful inside some interactive programs, mostly a no-op in bash.
      const byte = String.fromCharCode(c.charCodeAt(0) - 96);
      actions.sendTerminalStdin(threadId, byte).catch(() => {});
    }
    // Any other char: silently un-arm.
    setCtrlArmed(false);
  }, [threadId, actions, clearLocalTerminal]);

  const handleCmdCombo = useCallback(async (rawChar: string) => {
    const c = rawChar.toLowerCase();
    if (c === "k") {
      clearLocalTerminal();
    } else if (c === "c") {
      const snap = await actions.snapshotTerminal(threadId).catch(() => [] as string[]);
      const lines =
        snap.length > 0
          ? snap
          : (useGatewayStore.getState().terminal[threadId] ?? []).slice(-200);
      if (lines.length > 0) {
        Clipboard.setStringAsync(lines.join("\n")).catch(() => {});
        if (Platform.OS === "ios") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } else if (c === "v") {
      const text = await Clipboard.getStringAsync().catch(() => "");
      if (text) setCommand((prev) => prev + text);
    }
    setCmdArmed(false);
  }, [threadId, actions, clearLocalTerminal]);

  // Single entry-point for any char produced by the accessory bar.
  // If a modifier is armed, consume the char as a combo; otherwise append.
  const insertAtEnd = useCallback((s: string) => {
    if (ctrlArmed) {
      handleCtrlCombo(s[0] ?? "");
      return;
    }
    if (cmdArmed) {
      void handleCmdCombo(s[0] ?? "");
      return;
    }
    setCommand((prev) => prev + s);
  }, [ctrlArmed, cmdArmed, handleCtrlCombo, handleCmdCombo]);

  // Intercepts characters from the system keyboard. If a modifier is
  // armed and the user typed a char, we consume it as a combo and revert
  // the TextInput (via setNativeProps) so the typed char doesn't stay
  // visible in the prompt.
  const handleTextChange = useCallback((next: string) => {
    if ((ctrlArmed || cmdArmed) && next.length > command.length) {
      const inserted = next.slice(command.length, command.length + 1);
      // Roll the native view back to the previous value — state stays the
      // same so React and the native view end up aligned.
      inputRef.current?.setNativeProps({ text: command });
      if (ctrlArmed) handleCtrlCombo(inserted);
      else void handleCmdCombo(inserted);
      return;
    }
    setCommand(next);
  }, [ctrlArmed, cmdArmed, command, handleCtrlCombo, handleCmdCombo]);

  const clearInput = useCallback(() => {
    setCommand("");
    historyIdxRef.current = historyRef.current.length;
    draftRef.current = "";
  }, []);

  const armCtrl = useCallback(() => {
    setCtrlArmed((v) => !v);
    setCmdArmed(false);
    inputRef.current?.focus();
  }, []);

  const armCmd = useCallback(() => {
    setCmdArmed((v) => !v);
    setCtrlArmed(false);
    inputRef.current?.focus();
  }, []);

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
      presentationStyle="pageSheet"
      animationType="slide"
      visible={visible}
      onRequestClose={dismiss}
      onDismiss={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: TERMINAL_BG,
        }}
      >
        {/* Tiny status strip — cwd only, no buttons */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: SPACING.lg,
            paddingTop: SPACING.sm,
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
                onChangeText={handleTextChange}
                onSubmit={send}
                inputRef={inputRef}
                isDark={isDark}
                modifier={ctrlArmed ? "ctrl" : cmdArmed ? "cmd" : null}
              />
            </ScrollView>
          </Pressable>

          {/* Accessory key row — only while the keyboard is visible,
              otherwise it'd take screen space with no function. */}
          {keyboardHeight > 0 && (
            <AccessoryBar
              onInsert={insertAtEnd}
              onUp={historyUp}
              onDown={historyDown}
              onClear={clearInput}
              onDismissKeyboard={() => Keyboard.dismiss()}
              ctrlArmed={ctrlArmed}
              cmdArmed={cmdArmed}
              onArmCtrl={armCtrl}
              onArmCmd={armCmd}
            />
          )}

          {/* Bottom spacer that tracks the keyboard so the prompt doesn't
              hide under it. */}
        <View style={{ height: keyboardHeight > 0 ? keyboardHeight : Platform.OS === "ios" ? 28 : 8 }} />
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
  modifier,
}: {
  cwd: string;
  busy: boolean;
  value: string;
  onChangeText: (s: string) => void;
  onSubmit: () => void;
  inputRef: React.RefObject<TextInput | null>;
  isDark: boolean;
  modifier: "ctrl" | "cmd" | null;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 20,
        marginTop: 2,
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: TYPOGRAPHY.fontSizes.xs }}>
        <Text style={{ color: CWD_COLOR }}>{cwd || "~"}</Text>
        <Text style={{ color: PROMPT_COLOR }}>{busy ? " … " : " $ "}</Text>
        {modifier && (
          <Text style={{ color: "#FFD166", fontWeight: "700" }}>
            {modifier === "ctrl" ? "^" : "⌘"}
            {" "}
          </Text>
        )}
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
          padding: 0,
          margin: 0,
          includeFontPadding: false,
        }}
      />
    </View>
  );
}

function AccessoryBar({
  onInsert,
  onUp,
  onDown,
  onClear,
  onDismissKeyboard,
  ctrlArmed,
  cmdArmed,
  onArmCtrl,
  onArmCmd,
}: {
  onInsert: (s: string) => void;
  onUp: () => void;
  onDown: () => void;
  onClear: () => void;
  onDismissKeyboard: () => void;
  ctrlArmed: boolean;
  cmdArmed: boolean;
  onArmCtrl: () => void;
  onArmCmd: () => void;
}) {
  const tap = (fn: () => void) => () => {
    if (Platform.OS === "ios") {
      Haptics.selectionAsync().catch(() => {});
    }
    fn();
  };
  return (
    <View
      style={{
        height: 40,
        backgroundColor: "#17191C",
        borderTopWidth: 1,
        borderTopColor: "rgba(255,255,255,0.06)",
      }}
    >
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          alignItems: "center",
          paddingHorizontal: 8,
          gap: 6,
        }}
      >
        {/* Sticky modifiers — tap to arm, next key consumes and un-arms */}
        <AccKey label="ctrl" onPress={tap(onArmCtrl)} active={ctrlArmed} />
        <AccKey label="⌘" onPress={tap(onArmCmd)} active={cmdArmed} />
        <AccSep />
        <AccKey label="⎋" onPress={tap(onClear)} />
        <AccKey label="⇥" onPress={tap(() => onInsert("\t"))} />
        <AccSep />
        <AccKey label="↑" onPress={tap(onUp)} />
        <AccKey label="↓" onPress={tap(onDown)} />
        <AccSep />
        <AccKey label="/" onPress={tap(() => onInsert("/"))} />
        <AccKey label="-" onPress={tap(() => onInsert("-"))} />
        <AccKey label="_" onPress={tap(() => onInsert("_"))} />
        <AccKey label="~" onPress={tap(() => onInsert("~"))} />
        <AccKey label="|" onPress={tap(() => onInsert("|"))} />
        <AccKey label="\\" onPress={tap(() => onInsert("\\"))} />
        <AccKey label="*" onPress={tap(() => onInsert("*"))} />
        <AccKey label="&" onPress={tap(() => onInsert("&"))} />
        <AccKey label=">" onPress={tap(() => onInsert(">"))} />
        <AccKey label="<" onPress={tap(() => onInsert("<"))} />
        <AccKey label="$" onPress={tap(() => onInsert("$"))} />
        <AccKey label="`" onPress={tap(() => onInsert("`"))} />
        <AccSep />
        <AccKey label="⌄" onPress={tap(onDismissKeyboard)} />
      </ScrollView>
    </View>
  );
}

function AccKey({
  label,
  onPress,
  active,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        minWidth: 36,
        height: 30,
        borderRadius: 7,
        paddingHorizontal: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active
          ? "#FFD166"
          : pressed
          ? "rgba(255,255,255,0.18)"
          : "rgba(255,255,255,0.08)",
      })}
    >
      <Text
        style={{
          color: active ? "#17191C" : TERMINAL_FG,
          fontFamily: MONO,
          fontSize: 14,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function AccSep() {
  return (
    <View
      style={{
        width: 1,
        height: 18,
        backgroundColor: "rgba(255,255,255,0.12)",
        marginHorizontal: 2,
      }}
    />
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
