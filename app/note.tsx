import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigation } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useGatewayStore } from "@/store/gatewayStore";
import { usePalette } from "@/hooks/usePalette";
import { readLocalNoteContent } from "@/util/vault/localVault";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { IconSymbol } from "@/components/ui/IconSymbol";

// ── Formatting helpers ──────────────────────────────────────────────

type Selection = { start: number; end: number };

function wrapSelection(
  text: string,
  sel: Selection,
  before: string,
  after: string
): { text: string; sel: Selection } {
  const selected = text.slice(sel.start, sel.end);
  // If already wrapped, unwrap
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

function insertAtCursor(
  text: string,
  sel: Selection,
  insert: string
): { text: string; sel: Selection } {
  return {
    text: text.slice(0, sel.end) + insert + text.slice(sel.end),
    sel: { start: sel.end + insert.length, end: sel.end + insert.length },
  };
}

function prefixLine(
  text: string,
  sel: Selection,
  prefix: string
): { text: string; sel: Selection } {
  // Find the start of the current line
  const lineStart = text.lastIndexOf("\n", sel.start - 1) + 1;
  const lineEnd = text.indexOf("\n", sel.start);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  // Toggle: if line already starts with prefix, remove it
  if (line.startsWith(prefix)) {
    const newText = text.slice(0, lineStart) + line.slice(prefix.length) + text.slice(lineEnd === -1 ? text.length : lineEnd);
    return { text: newText, sel: { start: sel.start - prefix.length, end: sel.end - prefix.length } };
  }
  const newText = text.slice(0, lineStart) + prefix + text.slice(lineStart);
  return { text: newText, sel: { start: sel.start + prefix.length, end: sel.end + prefix.length } };
}

// ── Toolbar button ──────────────────────────────────────────────────

function ToolbarBtn({
  icon,
  label,
  onPress,
  palette,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  palette: any;
}) {
  return (
    <TouchableBounce sensory onPress={onPress}>
      <View
        style={{
          width: 38,
          height: 38,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          backgroundColor: palette.surfaceAlt,
        }}
      >
        <IconSymbol name={icon as any} size={16} color={palette.text} />
      </View>
    </TouchableBounce>
  );
}

// ── Main component ──────────────────────────────────────────────────

export default function NoteEditor() {
  const palette = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{
    provider?: string;
    vault?: string;
    note?: string;
    uri?: string;
    title?: string;
    path?: string;
  }>();
  const { serverUrl, bearerToken } = useGatewayStore((s) => s.settings);

  const [rawContent, setRawContent] = useState<string | null>(null);
  const [frontmatter, setFrontmatter] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isBackend = params.provider === "backend" || params.provider === "sync";

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
          if (!serverUrl || !bearerToken) throw new Error("Server URL or token missing.");
          const base = serverUrl.replace(/\/+$/, "");
          const res = await fetch(
            `${base}/obsidian/notes/read?path=${encodeURIComponent(params.vault)}&note=${encodeURIComponent(params.note)}`,
            { headers: { Authorization: `Bearer ${bearerToken}` } }
          );
          if (!res.ok) throw new Error(`Server returned ${res.status}`);
          const data = await res.json();
          text = data.content ?? "";
        } else {
          throw new Error("Missing note identifier.");
        }
        if (cancelled) return;
        setRawContent(text);
        // Split frontmatter from body
        const fmMatch = text.match(/^(---\n[\s\S]*?\n---\n?)/);
        if (fmMatch) {
          setFrontmatter(fmMatch[1]);
          setBody(text.slice(fmMatch[1].length));
        } else {
          setFrontmatter("");
          setBody(text);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Failed to load note");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [params.provider, params.vault, params.note, params.uri, serverUrl, bearerToken]);

  // ── Auto-save (debounced 1.5s after last edit) ──────────────────
  const save = useCallback(async (newBody: string) => {
    if (!isBackend || !params.vault || !params.note) return;
    if (!serverUrl || !bearerToken) return;
    setSaving(true);
    try {
      const fullContent = frontmatter + newBody;
      const base = serverUrl.replace(/\/+$/, "");
      const res = await fetch(`${base}/obsidian/notes/write`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: params.vault,
          note: params.note,
          content: fullContent,
        }),
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

  // Save when leaving the note (unmount)
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // Save on blur (keyboard dismiss) or back navigation
  const handleBlur = useCallback(() => {
    if (dirty) save(body);
  }, [dirty, body, save]);

  // Save when navigating away
  const navigation = useNavigation();
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
    Alert.alert(
      "Delete note",
      `Are you sure you want to delete "${params.title ?? params.note}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (!isBackend || !params.vault || !params.note) return;
            try {
              const base = serverUrl.replace(/\/+$/, "");
              await fetch(`${base}/obsidian/notes/delete`, {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${bearerToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ path: params.vault, note: params.note }),
              });
              router.back();
            } catch {
              Alert.alert("Error", "Failed to delete note.");
            }
          },
        },
      ]
    );
  };

  // ── Formatting actions ──────────────────────────────────────────
  const applyFormat = (action: string) => {
    let result: { text: string; sel: Selection };
    switch (action) {
      case "bold":
        result = wrapSelection(body, selection, "**", "**");
        break;
      case "italic":
        result = wrapSelection(body, selection, "*", "*");
        break;
      case "code":
        result = wrapSelection(body, selection, "`", "`");
        break;
      case "strikethrough":
        result = wrapSelection(body, selection, "~~", "~~");
        break;
      case "highlight":
        result = wrapSelection(body, selection, "==", "==");
        break;
      case "h1":
        result = prefixLine(body, selection, "# ");
        break;
      case "h2":
        result = prefixLine(body, selection, "## ");
        break;
      case "h3":
        result = prefixLine(body, selection, "### ");
        break;
      case "bullet":
        result = prefixLine(body, selection, "- ");
        break;
      case "checkbox":
        result = prefixLine(body, selection, "- [ ] ");
        break;
      case "quote":
        result = prefixLine(body, selection, "> ");
        break;
      case "link": {
        const selected = body.slice(selection.start, selection.end);
        const linkText = selected || "link text";
        result = {
          text: body.slice(0, selection.start) + `[[${linkText}]]` + body.slice(selection.end),
          sel: { start: selection.start + 2, end: selection.start + 2 + linkText.length },
        };
        break;
      }
      case "tag":
        result = insertAtCursor(body, selection, "#");
        break;
      case "divider":
        result = insertAtCursor(body, selection, "\n---\n");
        break;
      case "codeblock":
        result = insertAtCursor(body, selection, "\n```\n\n```\n");
        result.sel = { start: result.sel.start - 5, end: result.sel.start - 5 };
        break;
      default:
        return;
    }
    setBody(result.text);
    setDirty(true);
    // Move cursor
    setTimeout(() => {
      inputRef.current?.setNativeProps({ selection: result.sel });
    }, 50);
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
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
              {saving && <ActivityIndicator color={palette.textMuted} size="small" />}
              {dirty && !saving && (
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.accent }} />
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
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: palette.bg }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 95 : 0}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 80 }}
            contentInsetAdjustmentBehavior="automatic"
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
          >
            <TextInput
              ref={inputRef}
              value={body}
              onChangeText={onChangeText}
              onBlur={handleBlur}
              onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
              multiline
              scrollEnabled={false}
              autoCapitalize="sentences"
              autoCorrect
              textAlignVertical="top"
              style={{
                color: palette.text,
                fontSize: 16,
                lineHeight: 24,
                minHeight: 300,
              }}
              placeholderTextColor={palette.textMuted}
              placeholder="Start writing..."
              editable={isBackend}
            />
          </ScrollView>

          {/* ── Formatting toolbar ── */}
          {isBackend && (
            <View
              style={{
                flexDirection: "row",
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 8,
                backgroundColor: palette.surface,
                borderTopWidth: 0.5,
                borderTopColor: palette.surfaceAlt,
              }}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, alignItems: "center" }}
                keyboardShouldPersistTaps="always"
              >
                <ToolbarBtn icon="bold" label="Bold" onPress={() => applyFormat("bold")} palette={palette} />
                <ToolbarBtn icon="italic" label="Italic" onPress={() => applyFormat("italic")} palette={palette} />
                <ToolbarBtn icon="strikethrough" label="Strikethrough" onPress={() => applyFormat("strikethrough")} palette={palette} />
                <ToolbarBtn icon="highlighter" label="Highlight" onPress={() => applyFormat("highlight")} palette={palette} />
                <ToolbarBtn icon="chevron.left.forwardslash.chevron.right" label="Code" onPress={() => applyFormat("code")} palette={palette} />
                <View style={{ width: 1, height: 20, backgroundColor: palette.surfaceAlt }} />
                <ToolbarBtn icon="textformat.size" label="H1" onPress={() => applyFormat("h1")} palette={palette} />
                <ToolbarBtn icon="textformat.size.smaller" label="H2" onPress={() => applyFormat("h2")} palette={palette} />
                <View style={{ width: 1, height: 20, backgroundColor: palette.surfaceAlt }} />
                <ToolbarBtn icon="list.bullet" label="Bullet" onPress={() => applyFormat("bullet")} palette={palette} />
                <ToolbarBtn icon="checkmark.square" label="Checkbox" onPress={() => applyFormat("checkbox")} palette={palette} />
                <ToolbarBtn icon="text.quote" label="Quote" onPress={() => applyFormat("quote")} palette={palette} />
                <View style={{ width: 1, height: 20, backgroundColor: palette.surfaceAlt }} />
                <ToolbarBtn icon="link" label="Link" onPress={() => applyFormat("link")} palette={palette} />
                <ToolbarBtn icon="number" label="Tag" onPress={() => applyFormat("tag")} palette={palette} />
                <ToolbarBtn icon="minus" label="Divider" onPress={() => applyFormat("divider")} palette={palette} />
                <ToolbarBtn icon="curlybraces" label="Code Block" onPress={() => applyFormat("codeblock")} palette={palette} />
              </ScrollView>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </>
  );
}
