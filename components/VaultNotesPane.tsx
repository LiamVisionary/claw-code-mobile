import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { FlatList } from "react-native-gesture-handler";
import { useRouter } from "expo-router";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { useGatewayStore } from "@/store/gatewayStore";
import type { Palette } from "@/constants/palette";
import { listAllLocalNotes } from "@/util/vault/localVault";

type NoteRow = { key: string; path: string; title: string; updatedAt?: string };

/**
 * Renders a list of notes from the currently-configured Obsidian vault.
 * Handles both backend (VPS) and local (on-device) providers — picks the
 * right data source based on the stored settings.
 *
 * Tap a row → pushes `/note` with the provider + identifier in query
 * params; the reader route handles the actual fetch + markdown render.
 */
export function VaultNotesPane({ palette }: { palette: Palette }) {
  const router = useRouter();
  const settings = useGatewayStore((s) => s.settings);
  const vault = settings.obsidianVault;

  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const source = useMemo(() => {
    if (!vault?.enabled) return null;
    if (vault.provider === "backend" && vault.path) {
      return { kind: "backend" as const, path: vault.path };
    }
    if (vault.provider === "local" && vault.localDirectoryUri) {
      return { kind: "local" as const, uri: vault.localDirectoryUri };
    }
    return null;
  }, [vault?.enabled, vault?.provider, vault?.path, vault?.localDirectoryUri]);

  const loadNotes = useCallback(
    async (isRefresh = false) => {
      if (!source) {
        setNotes([]);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        if (source.kind === "backend") {
          const { serverUrl, bearerToken } = settings;
          if (!serverUrl || !bearerToken) {
            throw new Error("Configure server URL + token in Settings first.");
          }
          const base = serverUrl.replace(/\/+$/, "");
          const res = await fetch(
            `${base}/obsidian/notes?path=${encodeURIComponent(source.path)}`,
            { headers: { Authorization: `Bearer ${bearerToken}` } }
          );
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as any;
            throw new Error(body.error ?? `Server returned ${res.status}`);
          }
          const data = (await res.json()) as {
            notes: { path: string; title: string; updatedAt: string }[];
          };
          setNotes(
            data.notes.map((n) => ({
              key: n.path,
              path: n.path,
              title: n.title,
              updatedAt: n.updatedAt,
            }))
          );
        } else {
          const rows = await listAllLocalNotes(source.uri);
          setNotes(
            rows.map((r) => ({
              key: r.uri,
              path: r.path,
              title: r.title,
            }))
          );
        }
      } catch (err: any) {
        setError(err?.message ?? "Failed to load notes");
        setNotes([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [source, settings.serverUrl, settings.bearerToken]
  );

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const openNote = (row: NoteRow) => {
    if (!source) return;
    if (source.kind === "backend") {
      router.push(
        `/note?provider=backend&vault=${encodeURIComponent(source.path)}&note=${encodeURIComponent(row.path)}&title=${encodeURIComponent(row.title)}`
      );
    } else {
      router.push(
        `/note?provider=local&uri=${encodeURIComponent(row.key)}&title=${encodeURIComponent(row.title)}&path=${encodeURIComponent(row.path)}`
      );
    }
  };

  if (!source) {
    return (
      <View
        style={{
          flex: 1,
          paddingTop: 120,
          paddingHorizontal: 32,
          alignItems: "center",
          gap: 10,
        }}
      >
        <Text
          style={{
            color: palette.text,
            fontSize: 22,
            fontWeight: "500",
            letterSpacing: -0.3,
          }}
        >
          Vault not connected
        </Text>
        <Text
          style={{
            color: palette.textMuted,
            fontSize: 15,
            textAlign: "center",
            lineHeight: 22,
          }}
        >
          Connect an Obsidian vault under Settings → Obsidian Vault to see your
          notes here.
        </Text>
      </View>
    );
  }

  if (loading && notes.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={palette.textSoft} />
      </View>
    );
  }

  return (
    <FlatList
      data={notes}
      keyExtractor={(item) => item.key}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 80, flexGrow: 1 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => loadNotes(true)}
          tintColor={palette.textSoft}
        />
      }
      ItemSeparatorComponent={() => (
        <View
          style={{
            height: 1,
            marginHorizontal: 24,
            backgroundColor: palette.divider,
          }}
        />
      )}
      renderItem={({ item }) => (
        <TouchableBounce sensory onPress={() => openNote(item)}>
          <View
            style={{
              paddingHorizontal: 24,
              paddingVertical: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <IconSymbol name="doc.text" color={palette.textMuted} size={18} />
            <View style={{ flex: 1 }}>
              <Text
                style={{ color: palette.text, fontSize: 16, fontWeight: "500" }}
                numberOfLines={1}
              >
                {item.title}
              </Text>
              {item.path !== `${item.title}.md` && (
                <Text
                  style={{ color: palette.textSoft, fontSize: 12, marginTop: 2 }}
                  numberOfLines={1}
                >
                  {item.path}
                </Text>
              )}
            </View>
          </View>
        </TouchableBounce>
      )}
      ListEmptyComponent={() => (
        <View
          style={{
            flex: 1,
            paddingTop: 120,
            paddingHorizontal: 32,
            alignItems: "center",
            gap: 10,
          }}
        >
          <Text
            style={{
              color: palette.text,
              fontSize: 20,
              fontWeight: "500",
            }}
          >
            {error ? "Couldn't load notes" : "No notes yet"}
          </Text>
          <Text
            style={{
              color: palette.textMuted,
              fontSize: 14,
              textAlign: "center",
              lineHeight: 20,
            }}
          >
            {error ??
              "Add markdown files to your vault and they'll appear here."}
          </Text>
        </View>
      )}
    />
  );
}
