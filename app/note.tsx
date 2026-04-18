import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import Markdown from "react-native-markdown-display";
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView } from "expo-glass-effect";
import { useGatewayStore } from "@/store/gatewayStore";
import { usePalette } from "@/hooks/usePalette";
import { readLocalNoteContent } from "@/util/vault/localVault";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { IconSymbol } from "@/components/ui/IconSymbol";

// ── Formatting helpers ──────────────────────────────────────────────

type Selection = { start: number; end: number };

function wrapSelection(text: string, sel: Selection, before: string, after: string) {
  const selected = text.slice(sel.start, sel.end);
  const prefix = text.slice(Math.max(0, sel.start - before.length), sel.start);
  const suffix = text.slice(sel.end, sel.end + after.length);
  if (prefix === before && suffix === after) {
    return {
      text: text.slice(0, sel.start - before.length) + selected + text.slice(sel.end + after.length),
      sel: { start: sel.start - before.length, end: sel.end - before.length },
    };
  }
  return {
    text: text.slice(0, sel.start) + before + selected + after + text.slice(sel.end),
    sel: { start: sel.start + before.length, end: sel.end + before.length },
  };
}

function insertAtCursor(text: string, sel: Selection, insert: string, cursorOffset = 0) {
  return {
    text: text.slice(0, sel.end) + insert + text.slice(sel.end),
    sel: { start: sel.end + insert.length + cursorOffset, end: sel.end + insert.length + cursorOffset },
  };
}

function prefixLine(text: string, sel: Selection, prefix: string) {
  const lineStart = text.lastIndexOf("\n", sel.start - 1) + 1;
  const lineEnd = text.indexOf("\n", sel.start);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  if (line.startsWith(prefix)) {
    const newText = text.slice(0, lineStart) + line.slice(prefix.length) + text.slice(lineEnd === -1 ? text.length : lineEnd);
    return { text: newText, sel: { start: sel.start - prefix.length, end: sel.end - prefix.length } };
  }
  const newText = text.slice(0, lineStart) + prefix + text.slice(lineStart);
  return { text: newText, sel: { start: sel.start + prefix.length, end: sel.end + prefix.length } };
}

// ── Toolbar button ──────────────────────────────────────────────────

function TBtn({ icon, onPress, palette, label }: { icon: string; onPress: () => void; palette: any; label?: string }) {
  return (
    <TouchableBounce sensory onPress={onPress}>
      <View style={{ alignItems: "center", justifyContent: "center", paddingHorizontal: 10, paddingVertical: 8 }}>
        {label ? (
          <Text style={{ color: palette.text, fontSize: 13, fontWeight: "700" }}>{label}</Text>
        ) : (
          <IconSymbol name={icon as any} size={17} color={palette.text} />
        )}
      </View>
    </TouchableBounce>
  );
}

// ── Main component ──────────────────────────────────────────────────

export default function NoteEditor() {
  const palette = usePalette();
  const router = useRouter();
  const navigation = useNavigation();
  const { bottom } = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();
  const params = useLocalSearchParams<{
    provider?: string;
    vault?: string;
    note?: string;
    uri?: string;
    title?: string;
  }>();
  const { serverUrl, bearerToken } = useGatewayStore((s) => s.settings);

  const [rawContent, setRawContent] = useState<string | null>(null);
  const [frontmatter, setFrontmatter] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);
  const isBackend = params.provider === "backend" || params.provider === "sync";

  // Animated keyboard offset for the floating toolbar
  const toolbarStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboard.height.value }],
  }));

  // ── Load note ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        let text = "";
        if (params.provider === "local" && params.uri) {
          text = await readLocalNoteContent(params.uri);
        } else if (isBackend && params.vault && params.note) {
          if (!serverUrl || !bearerToken) throw new Error("Server not configured.");
          const res = await fetch(
            `${serverUrl.replace(/\/+$/, "")}/obsidian/notes/read?path=${encodeURIComponent(params.vault)}&note=${encodeURIComponent(params.note)}`,
            { headers: { Authorization: `Bearer ${bearerToken}` } }
          );
          if (!res.ok) throw new Error(`Server returned ${res.status}`);
          const data = await res.json();
          text = data.content ?? "";
        } else {
          throw new Error("Missing note identifier.");
        }
        if (cancelled) return;
        const fmMatch = text.match(/^(---\n[\s\S]*?\n---\n?)/);
        setFrontmatter(fmMatch ? fmMatch[1] : "");
        setBody(fmMatch ? text.slice(fmMatch[1].length) : text);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Failed to load note");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [params.provider, params.vault, params.note, params.uri, serverUrl, bearerToken]);

  // ── Save ────────────────────────────────────────────────────────
  const save = useCallback(async (text: string) => {
    if (!isBackend || !params.vault || !params.note || !serverUrl || !bearerToken) return;
    setSaving(true);
    try {
      const res = await fetch(`${serverUrl.replace(/\/+$/, "")}/obsidian/notes/write`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ path: params.vault, note: params.note, content: frontmatter + text }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      setDirty(false);
    } catch (err: any) {
      setError(err?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }, [isBackend, params.vault, params.note, serverUrl, bearerToken, frontmatter]);

  const onChangeText = useCallback((text: string) => {
    setBody(text);
    setDirty(true);
  }, []);

  // Save + switch to preview when keyboard closes
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidHide", () => {
      if (dirty) save(body);
      setEditing(false);
    });
    return () => sub.remove();
  }, [dirty, body, save]);

  // Save when navigating away
  const dirtyRef = useRef(false);
  const bodyRef = useRef(body);
  dirtyRef.current = dirty;
  bodyRef.current = body;
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", () => {
      if (dirtyRef.current) save(bodyRef.current);
    });
    return unsub;
  }, [navigation, save]);

  // ── Delete ──────────────────────────────────────────────────────
  const handleDelete = () => {
    Alert.alert("Delete note", `Delete "${params.title ?? params.note}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await fetch(`${serverUrl!.replace(/\/+$/, "")}/obsidian/notes/delete`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({ path: params.vault, note: params.note }),
            });
            router.back();
          } catch { Alert.alert("Error", "Failed to delete note."); }
        },
      },
    ]);
  };

  // ── Formatting ──────────────────────────────────────────────────
  const applyFormat = (action: string) => {
    let result: { text: string; sel: Selection };
    switch (action) {
      case "bold": result = wrapSelection(body, selection, "**", "**"); break;
      case "italic": result = wrapSelection(body, selection, "*", "*"); break;
      case "code": result = wrapSelection(body, selection, "`", "`"); break;
      case "strike": result = wrapSelection(body, selection, "~~", "~~"); break;
      case "highlight": result = wrapSelection(body, selection, "==", "=="); break;
      case "h1": result = prefixLine(body, selection, "# "); break;
      case "h2": result = prefixLine(body, selection, "## "); break;
      case "h3": result = prefixLine(body, selection, "### "); break;
      case "bullet": result = prefixLine(body, selection, "- "); break;
      case "checkbox": result = prefixLine(body, selection, "- [ ] "); break;
      case "quote": result = prefixLine(body, selection, "> "); break;
      case "link": {
        const sel = body.slice(selection.start, selection.end) || "note";
        result = {
          text: body.slice(0, selection.start) + `[[${sel}]]` + body.slice(selection.end),
          sel: { start: selection.start + 2, end: selection.start + 2 + sel.length },
        };
        break;
      }
      case "tag": result = insertAtCursor(body, selection, "#"); break;
      case "divider": result = insertAtCursor(body, selection, "\n---\n"); break;
      case "codeblock":
        // Insert code block and place cursor inside
        result = insertAtCursor(body, selection, "\n```\n\n```\n", -5);
        break;
      default: return;
    }
    setBody(result.text);
    setDirty(true);
    setTimeout(() => inputRef.current?.setNativeProps({ selection: result.sel }), 50);
  };

  // ── Markdown styles ─────────────────────────────────────────────
  const mdStyles = {
    body: { color: palette.text, fontSize: 16, lineHeight: 24 },
    heading1: { color: palette.text, fontSize: 24, fontWeight: "700" as const, marginTop: 8, marginBottom: 12 },
    heading2: { color: palette.text, fontSize: 20, fontWeight: "600" as const, marginTop: 12, marginBottom: 8 },
    heading3: { color: palette.text, fontSize: 17, fontWeight: "600" as const, marginTop: 10, marginBottom: 6 },
    paragraph: { color: palette.text, marginBottom: 10 },
    code_inline: { backgroundColor: palette.surfaceAlt, color: palette.text, paddingHorizontal: 4, borderRadius: 4 },
    fence: { backgroundColor: palette.surfaceAlt, borderRadius: 8, padding: 12, color: palette.text },
    blockquote: { backgroundColor: palette.surfaceAlt, borderLeftColor: palette.accent, borderLeftWidth: 3, paddingHorizontal: 12, paddingVertical: 4 },
    link: { color: palette.accent },
    bullet_list_icon: { color: palette.text },
    ordered_list_icon: { color: palette.text },
  };

  // ── Render ──────────────────────────────────────────────────────
  return (
    <>
      <Stack.Screen
        options={{
          title: params.title ?? "Note",
          headerStyle: { backgroundColor: palette.bg },
          headerTitleStyle: { color: palette.text, fontWeight: "600" },
          headerTintColor: palette.accent,
          contentStyle: { backgroundColor: palette.bg },
          headerRight: () => (
            <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
              {saving && <ActivityIndicator color={palette.textMuted} size="small" />}
              {dirty && !saving && (
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.accent }} />
              )}
              {isBackend && !editing && (
                <TouchableBounce sensory onPress={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 100); }}>
                  <View style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center" }}>
                    <IconSymbol name="pencil" size={18} color={palette.accent} />
                  </View>
                </TouchableBounce>
              )}
              {isBackend && (
                <TouchableBounce sensory onPress={handleDelete}>
                  <View style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center" }}>
                    <IconSymbol name="trash" size={18} color={palette.danger} />
                  </View>
                </TouchableBounce>
              )}
            </View>
          ),
        }}
      />
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.bg }}>
          <ActivityIndicator color={palette.textSoft} />
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: palette.bg }}>
          <Text style={{ color: palette.danger, fontSize: 15, textAlign: "center" }}>{error}</Text>
        </View>
      ) : (
        <View style={{ flex: 1, backgroundColor: palette.bg }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: editing ? 120 : 40 }}
            contentInsetAdjustmentBehavior="automatic"
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
          >
            {editing ? (
              <TextInput
                ref={inputRef}
                value={body}
                onChangeText={onChangeText}
                onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
                multiline
                scrollEnabled={false}
                autoFocus
                autoCapitalize="sentences"
                autoCorrect
                textAlignVertical="top"
                keyboardAppearance={palette.bg === "#000" || palette.bg === "#000000" ? "dark" : "light"}
                style={{ color: palette.text, fontSize: 16, lineHeight: 24, minHeight: 300 }}
                placeholderTextColor={palette.textMuted}
                placeholder="Start writing..."
              />
            ) : (
              <TouchableBounce
                sensory
                onPress={() => {
                  if (isBackend) {
                    setEditing(true);
                    setTimeout(() => inputRef.current?.focus(), 100);
                  }
                }}
              >
                <Markdown style={mdStyles}>
                  {body || "*Empty note — tap to edit*"}
                </Markdown>
              </TouchableBounce>
            )}
          </ScrollView>

          {/* ── Floating glass formatting toolbar ── */}
          {editing && isBackend && (
            <Animated.View
              style={[
                {
                  position: "absolute",
                  bottom: bottom + 8,
                  left: 12,
                  right: 12,
                },
                toolbarStyle,
              ]}
            >
              <GlassView
                glassEffectStyle="regular"
                isInteractive
                style={{
                  borderRadius: 16,
                  overflow: "hidden",
                  paddingVertical: 2,
                }}
              >
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ alignItems: "center", paddingHorizontal: 4 }}
                  keyboardShouldPersistTaps="always"
                >
                  <TBtn label="B" icon="" onPress={() => applyFormat("bold")} palette={palette} />
                  <TBtn label="I" icon="" onPress={() => applyFormat("italic")} palette={palette} />
                  <TBtn label="S" icon="" onPress={() => applyFormat("strike")} palette={palette} />
                  <TBtn icon="highlighter" onPress={() => applyFormat("highlight")} palette={palette} />
                  <TBtn icon="chevron.left.forwardslash.chevron.right" onPress={() => applyFormat("code")} palette={palette} />
                  <View style={{ width: 1, height: 18, backgroundColor: "rgba(128,128,128,0.3)", marginHorizontal: 2 }} />
                  <TBtn label="H1" icon="" onPress={() => applyFormat("h1")} palette={palette} />
                  <TBtn label="H2" icon="" onPress={() => applyFormat("h2")} palette={palette} />
                  <TBtn label="H3" icon="" onPress={() => applyFormat("h3")} palette={palette} />
                  <View style={{ width: 1, height: 18, backgroundColor: "rgba(128,128,128,0.3)", marginHorizontal: 2 }} />
                  <TBtn icon="list.bullet" onPress={() => applyFormat("bullet")} palette={palette} />
                  <TBtn icon="checkmark.square" onPress={() => applyFormat("checkbox")} palette={palette} />
                  <TBtn icon="text.quote" onPress={() => applyFormat("quote")} palette={palette} />
                  <View style={{ width: 1, height: 18, backgroundColor: "rgba(128,128,128,0.3)", marginHorizontal: 2 }} />
                  <TBtn icon="link" onPress={() => applyFormat("link")} palette={palette} />
                  <TBtn icon="number" onPress={() => applyFormat("tag")} palette={palette} />
                  <TBtn icon="minus" onPress={() => applyFormat("divider")} palette={palette} />
                  <TBtn icon="curlybraces" onPress={() => applyFormat("codeblock")} palette={palette} />
                  <View style={{ width: 1, height: 18, backgroundColor: "rgba(128,128,128,0.3)", marginHorizontal: 2 }} />
                  <TBtn icon="keyboard.chevron.compact.down" onPress={() => Keyboard.dismiss()} palette={palette} />
                </ScrollView>
              </GlassView>
            </Animated.View>
          )}
        </View>
      )}
    </>
  );
}
