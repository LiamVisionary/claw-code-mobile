import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Reanimated, {
  SharedValue,
  useAnimatedStyle,
  interpolate,
} from "react-native-reanimated";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { useGatewayStore } from "@/store/gatewayStore";
import type { Thread } from "@/store/gatewayStore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { Stack } from "expo-router";
import DirectoryBrowser from "@/components/DirectoryBrowser";
import { usePalette } from "@/hooks/usePalette";
import type { Palette } from "@/constants/palette";

// ─── Right-side swipe actions (Delete + Duplicate) ───────────────────────────

function RightActions({
  prog,
  drag,
  onDelete,
  onDuplicate,
  palette,
}: {
  prog: SharedValue<number>;
  drag: SharedValue<number>;
  onDelete: () => void;
  onDuplicate: () => void;
  palette: Palette;
}) {
  const TOTAL_WIDTH = 152; // 76 per button

  const containerStyle = useAnimatedStyle(() => {
    const width = interpolate(prog.value, [0, 1], [0, TOTAL_WIDTH], "clamp");
    return { width, overflow: "hidden" };
  });

  return (
    <Reanimated.View style={[{ flexDirection: "row", alignItems: "stretch" }, containerStyle]}>
      {/* Duplicate */}
      <TouchableBounce sensory onPress={onDuplicate}>
        <View
          style={{
            width: 76,
            flex: 1,
            backgroundColor: palette.accent,
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
          }}
        >
          <IconSymbol name="doc.on.doc" color="#fff" size={20} />
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>Duplicate</Text>
        </View>
      </TouchableBounce>

      {/* Delete */}
      <TouchableBounce sensory onPress={onDelete}>
        <View
          style={{
            width: 76,
            flex: 1,
            backgroundColor: palette.danger,
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            borderTopRightRadius: 16,
            borderBottomRightRadius: 16,
          }}
        >
          <IconSymbol name="trash" color="#fff" size={20} />
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>Delete</Text>
        </View>
      </TouchableBounce>
    </Reanimated.View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ChatListScreen() {
  const router = useRouter();
  const { threads, loadingThreads, _hasHydrated } = useGatewayStore();
  const actions = useGatewayStore((s) => s.actions);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const { bottom } = useSafeAreaInsets();
  const palette = usePalette();

  useEffect(() => {
    if (!_hasHydrated) return;
    actions.loadThreads().catch((err) => setError(err.message));
  }, [_hasHydrated, actions]);

  useFocusEffect(
    useCallback(() => {
      if (_hasHydrated) {
        actions.loadThreads().catch(() => {});
      }
    }, [_hasHydrated, actions])
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && _hasHydrated) {
        actions.loadThreads().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [_hasHydrated, actions]);

  const sortedThreads = [...threads].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const handleNewChat = () => setShowBrowser(true);

  const handleDirectorySelected = async (selectedPath: string) => {
    setShowBrowser(false);
    setCreating(true);
    setError(null);
    try {
      const thread = await actions.createThread(selectedPath);
      actions.setActiveThread(thread.id);
      router.push(`/thread/${thread.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = (thread: Thread) => {
    Alert.alert(
      "Delete conversation",
      `"${thread.title}" will be permanently deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => actions.deleteThread(thread.id).catch(() => {}),
        },
      ]
    );
  };

  const handleDuplicate = async (thread: Thread) => {
    try {
      const copy = await actions.duplicateThread(thread.id);
      actions.setActiveThread(copy.id);
      router.push(`/thread/${copy.id}`);
    } catch {
      setError("Failed to duplicate conversation.");
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Chats",
          headerRight: () => (
            <TouchableBounce sensory onPress={handleNewChat} disabled={creating}>
              <View
                style={{
                  padding: 8,
                  backgroundColor: palette.text,
                  borderRadius: 12,
                  opacity: creating ? 0.5 : 1,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {creating
                  ? <ActivityIndicator color={palette.bg} size="small" />
                  : <IconSymbol name="plus" color={palette.bg} size={16} />}
              </View>
            </TouchableBounce>
          ),
        }}
      />
      <View
        style={{
          flex: 1,
          backgroundColor: palette.bg,
          paddingTop: 12,
          paddingBottom: bottom + 16,
        }}
      >
        {error && (
          <Text style={{ color: palette.danger, fontSize: 13, marginBottom: 12, paddingHorizontal: 16 }}>
            {error}
          </Text>
        )}

        {!_hasHydrated || loadingThreads ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={sortedThreads}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
            renderItem={({ item }) => (
              <SwipeableChatRow
                thread={item}
                onPress={() => {
                  actions.setActiveThread(item.id);
                  router.push(`/thread/${item.id}`);
                }}
                onDelete={() => handleDelete(item)}
                onDuplicate={() => handleDuplicate(item)}
                palette={palette}
              />
            )}
            ListEmptyComponent={() => (
              <View
                style={{
                  flex: 1,
                  paddingTop: 80,
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <IconSymbol name="bubble.left.and.bubble.right" color={palette.textSoft} size={40} />
                <Text style={{ color: palette.textMuted, fontSize: 16, fontWeight: "600" }}>
                  No chats yet
                </Text>
                <TouchableBounce sensory onPress={handleNewChat} disabled={creating}>
                  <View
                    style={{
                      marginTop: 4,
                      backgroundColor: palette.text,
                      paddingHorizontal: 24,
                      paddingVertical: 12,
                      borderRadius: 14,
                    }}
                  >
                    <Text style={{ color: palette.bg, fontWeight: "600" }}>
                      Start a chat
                    </Text>
                  </View>
                </TouchableBounce>
              </View>
            )}
          />
        )}
      </View>

      <DirectoryBrowser
        visible={showBrowser}
        onSelect={handleDirectorySelected}
        onCancel={() => setShowBrowser(false)}
      />
    </>
  );
}

// ─── Swipeable row ─────────────────────────────────────────────────────────────

function SwipeableChatRow({
  thread,
  onPress,
  onDelete,
  onDuplicate,
  palette,
}: {
  thread: Thread;
  onPress: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  palette: Palette;
}) {
  const swipeRef = useRef<any>(null);

  const close = () => swipeRef.current?.close();

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      overshootRight={false}
      rightThreshold={60}
      renderRightActions={(prog, drag) => (
        <RightActions
          prog={prog}
          drag={drag}
          onDelete={() => { close(); onDelete(); }}
          onDuplicate={() => { close(); onDuplicate(); }}
          palette={palette}
        />
      )}
    >
      <ChatRow thread={thread} onPress={onPress} palette={palette} />
    </ReanimatedSwipeable>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ChatRow({ thread, onPress, palette }: { thread: Thread; onPress: () => void; palette: Palette }) {
  const isRunning = thread.status === "running";
  const dirName = thread.workDir ? thread.workDir.split("/").filter(Boolean).pop() : null;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}>
      <View
        style={{
          backgroundColor: palette.surface,
          borderRadius: 16,
          padding: 16,
          borderColor: palette.divider,
          borderWidth: 1,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: palette.text, fontSize: 15, fontWeight: "600", flex: 1 }} numberOfLines={1}>
            {thread.title}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {isRunning && (
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.accent }} />
            )}
            <Text style={{ color: palette.textMuted, fontSize: 12 }}>
              {timeAgo(thread.updatedAt)}
            </Text>
          </View>
        </View>
        {dirName && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 11 }}>📁</Text>
            <Text
              style={{
                color: palette.textMuted,
                fontSize: 12,
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              }}
              numberOfLines={1}
            >
              {dirName}
            </Text>
          </View>
        )}
        {thread.lastMessagePreview ? (
          <Text style={{ color: palette.textMuted, fontSize: 14 }} numberOfLines={2}>
            {thread.lastMessagePreview}
          </Text>
        ) : (
          <Text style={{ color: palette.textSoft, fontSize: 14, fontStyle: "italic" }}>
            No messages yet
          </Text>
        )}
      </View>
    </Pressable>
  );
}
