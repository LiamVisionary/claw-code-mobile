import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as AC from "@bacons/apple-colors";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { useGatewayStore } from "@/store/gatewayStore";
import type { Thread } from "@/store/gatewayStore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { Stack } from "expo-router";
import DirectoryBrowser from "@/components/DirectoryBrowser";

export default function ChatListScreen() {
  const router = useRouter();
  const { threads, loadingThreads } = useGatewayStore();
  const actions = useGatewayStore((s) => s.actions);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const { bottom } = useSafeAreaInsets();

  useEffect(() => {
    actions.loadThreads().catch((err) => setError(err.message));
  }, [actions]);

  const sortedThreads = [...threads].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const handleNewChat = () => {
    setShowBrowser(true);
  };

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
                  backgroundColor: AC.label,
                  borderRadius: 12,
                  opacity: creating ? 0.5 : 1,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {creating
                  ? <ActivityIndicator color={AC.systemBackground} size="small" />
                  : <IconSymbol name="plus" color={AC.systemBackground} size={16} />}
              </View>
            </TouchableBounce>
          ),
        }}
      />
      <View
        style={{
          flex: 1,
          backgroundColor: AC.systemGroupedBackground,
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: bottom + 16,
        }}
      >
        {error && (
          <Text style={{ color: AC.systemRed, fontSize: 13, marginBottom: 12 }}>
            {error}
          </Text>
        )}

        {loadingThreads ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={sortedThreads}
            keyExtractor={(item) => item.id}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            renderItem={({ item }) => (
              <ChatRow
                thread={item}
                onPress={() => {
                  actions.setActiveThread(item.id);
                  router.push(`/thread/${item.id}`);
                }}
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
                <IconSymbol name="bubble.left.and.bubble.right" color={AC.systemGray3} size={40} />
                <Text style={{ color: AC.systemGray, fontSize: 16, fontWeight: "600" }}>
                  No chats yet
                </Text>
                <TouchableBounce sensory onPress={handleNewChat} disabled={creating}>
                  <View
                    style={{
                      marginTop: 4,
                      backgroundColor: AC.label,
                      paddingHorizontal: 24,
                      paddingVertical: 12,
                      borderRadius: 14,
                    }}
                  >
                    <Text style={{ color: AC.systemBackground, fontWeight: "600" }}>
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

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ChatRow({ thread, onPress }: { thread: Thread; onPress: () => void }) {
  const isRunning = thread.status === "running";
  const dirName = thread.workDir ? thread.workDir.split("/").filter(Boolean).pop() : null;
  return (
    <TouchableBounce onPress={onPress} sensory>
      <View
        style={{
          backgroundColor: AC.secondarySystemGroupedBackground,
          borderRadius: 16,
          padding: 16,
          borderColor: AC.separator,
          borderWidth: 1,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: AC.label, fontSize: 15, fontWeight: "600", flex: 1 }} numberOfLines={1}>
            {thread.title}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {isRunning && (
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: AC.systemBlue }} />
            )}
            <Text style={{ color: AC.systemGray2, fontSize: 12 }}>
              {timeAgo(thread.updatedAt)}
            </Text>
          </View>
        </View>
        {dirName && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 11 }}>📁</Text>
            <Text style={{ color: AC.systemGray, fontSize: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }} numberOfLines={1}>
              {dirName}
            </Text>
          </View>
        )}
        {thread.lastMessagePreview ? (
          <Text style={{ color: AC.systemGray, fontSize: 14 }} numberOfLines={2}>
            {thread.lastMessagePreview}
          </Text>
        ) : (
          <Text style={{ color: AC.systemGray2, fontSize: 14, fontStyle: "italic" }}>
            No messages yet
          </Text>
        )}
      </View>
    </TouchableBounce>
  );
}
