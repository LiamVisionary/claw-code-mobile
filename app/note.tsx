import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import Markdown from "react-native-markdown-display";
import { useGatewayStore } from "@/store/gatewayStore";
import { usePalette } from "@/hooks/usePalette";
import { readLocalNoteContent } from "@/util/vault/localVault";

export default function NoteReader() {
  const palette = usePalette();
  const params = useLocalSearchParams<{
    provider?: "backend" | "local";
    vault?: string;
    note?: string;
    uri?: string;
    title?: string;
    path?: string;
  }>();
  const { serverUrl, bearerToken } = useGatewayStore((s) => s.settings);

  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (params.provider === "local" && params.uri) {
          const text = await readLocalNoteContent(params.uri);
          if (!cancelled) setContent(text);
        } else if ((params.provider === "backend" || params.provider === "sync") && params.vault && params.note) {
          if (!serverUrl || !bearerToken) {
            throw new Error("Server URL or token missing.");
          }
          const base = serverUrl.replace(/\/+$/, "");
          const res = await fetch(
            `${base}/obsidian/notes/read?path=${encodeURIComponent(
              params.vault
            )}&note=${encodeURIComponent(params.note)}`,
            { headers: { Authorization: `Bearer ${bearerToken}` } }
          );
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as any;
            throw new Error(body.error ?? `Server returned ${res.status}`);
          }
          const data = (await res.json()) as { content: string };
          if (!cancelled) setContent(data.content);
        } else {
          throw new Error("Missing note identifier.");
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Failed to load note");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [params.provider, params.vault, params.note, params.uri, serverUrl, bearerToken]);

  return (
    <>
      <Stack.Screen
        options={{
          title: params.title ?? "Note",
          headerStyle: { backgroundColor: palette.bg },
          headerTitleStyle: { color: palette.text, fontWeight: "600" },
          headerTintColor: palette.accent,
          contentStyle: { backgroundColor: palette.bg },
        }}
      />
      {loading ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette.bg,
          }}
        >
          <ActivityIndicator color={palette.textSoft} />
        </View>
      ) : error ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            backgroundColor: palette.bg,
          }}
        >
          <Text
            style={{ color: palette.danger, fontSize: 15, textAlign: "center" }}
          >
            {error}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ backgroundColor: palette.bg }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 20 }}
          contentInsetAdjustmentBehavior="automatic"
        >
          <Markdown
            style={{
              body: { color: palette.text, fontSize: 16, lineHeight: 24 },
              heading1: {
                color: palette.text,
                fontSize: 24,
                fontWeight: "700",
                marginTop: 8,
                marginBottom: 12,
              },
              heading2: {
                color: palette.text,
                fontSize: 20,
                fontWeight: "600",
                marginTop: 12,
                marginBottom: 8,
              },
              heading3: {
                color: palette.text,
                fontSize: 17,
                fontWeight: "600",
                marginTop: 10,
                marginBottom: 6,
              },
              paragraph: { color: palette.text, marginBottom: 10 },
              code_inline: {
                backgroundColor: palette.surfaceAlt,
                color: palette.text,
                paddingHorizontal: 4,
                borderRadius: 4,
              },
              fence: {
                backgroundColor: palette.surfaceAlt,
                borderRadius: 8,
                padding: 12,
                color: palette.text,
              },
              blockquote: {
                backgroundColor: palette.surfaceAlt,
                borderLeftColor: palette.accent,
                borderLeftWidth: 3,
                paddingHorizontal: 12,
                paddingVertical: 4,
              },
              link: { color: palette.accent },
            }}
          >
            {content ?? ""}
          </Markdown>
        </ScrollView>
      )}
    </>
  );
}
