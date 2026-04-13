import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as AC from "@bacons/apple-colors";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { useGatewayStore } from "@/store/gatewayStore";
import type { Thread } from "@/store/gatewayStore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconSymbol } from "@/components/ui/IconSymbol";

export default function ThreadListScreen() {
  const router = useRouter();
  const { threads, loadingThreads } = useGatewayStore();
  const actions = useGatewayStore((s) => s.actions);
  const [title, setTitle] = useState("");
  const [repoName, setRepoName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { bottom } = useSafeAreaInsets();

  useEffect(() => {
    actions.loadThreads().catch((err) => setError(err.message));
  }, [actions]);

  const sortedThreads = [...threads].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const handleCreate = async () => {
    if (!title.trim() || !repoName.trim()) {
      setError("Title and repo are required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const thread = await actions.createThread({
        title: title.trim(),
        repoName: repoName.trim(),
      });
      setTitle("");
      setRepoName("");
      actions.setActiveThread(thread.id);
      router.push(`/thread/${thread.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: AC.systemGroupedBackground,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: bottom + 16,
        gap: 16,
      }}
    >
      <View
        style={{
          backgroundColor: AC.secondarySystemGroupedBackground,
          borderRadius: 16,
          padding: 16,
          gap: 12,
          borderWidth: 1,
          borderColor: AC.separator,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "600", color: AC.label }}>
          New thread
        </Text>
        <TextInput
          placeholder="Title"
          placeholderTextColor={AC.systemGray}
          value={title}
          onChangeText={setTitle}
          autoCapitalize="sentences"
          style={inputStyle}
        />
        <TextInput
          placeholder="Repo name"
          placeholderTextColor={AC.systemGray}
          value={repoName}
          onChangeText={setRepoName}
          autoCapitalize="none"
          style={inputStyle}
        />
        <TouchableBounce
          disabled={submitting}
          onPress={handleCreate}
          sensory
          style={{
            opacity: submitting ? 0.6 : 1,
          }}
        >
          <View
            style={{
              backgroundColor: AC.label,
              borderRadius: 12,
              paddingVertical: 12,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text style={{ color: AC.systemBackground, fontWeight: "600" }}>
              Create thread
            </Text>
          </View>
        </TouchableBounce>
        {error && (
          <Text style={{ color: AC.systemRed, fontSize: 12 }}>{error}</Text>
        )}
      </View>

      <View style={{ flex: 1 }}>
        {loadingThreads && (
          <View
            style={{
              paddingVertical: 24,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ActivityIndicator />
          </View>
        )}
        <FlatList
          data={sortedThreads}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={({ item }) => (
            <ThreadRow
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
                paddingVertical: 48,
                alignItems: "center",
                gap: 8,
              }}
            >
              <IconSymbol
                name="ellipsis.bubble"
                color={AC.systemGray2}
                size={32}
              />
              <Text style={{ color: AC.systemGray }}>No threads yet</Text>
            </View>
          )}
        />
      </View>
    </View>
  );
}

function ThreadRow({ thread, onPress }: { thread: Thread; onPress: () => void }) {
  const statusColor = (() => {
    switch (thread.status) {
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

  return (
    <TouchableBounce onPress={onPress} sensory>
      <View
        style={{
          backgroundColor: AC.secondarySystemGroupedBackground,
          borderRadius: 16,
          padding: 16,
          borderColor: AC.separator,
          borderWidth: 1,
          gap: 8,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View>
            <Text style={{ color: AC.label, fontSize: 16, fontWeight: "600" }}>
              {thread.title}
            </Text>
            <Text style={{ color: AC.systemGray, fontSize: 13 }}>
              {thread.repoName}
            </Text>
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <View
              style={{
                backgroundColor: statusColor,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
              }}
            >
              <Text style={{ color: AC.systemBackground, fontSize: 12 }}>
                {thread.status}
              </Text>
            </View>
          </View>
        </View>
        <Text style={{ color: AC.label }} numberOfLines={2}>
          {thread.lastMessagePreview || "No messages yet"}
        </Text>
        <Text style={{ color: AC.systemGray2, fontSize: 12 }}>
          Updated {new Date(thread.updatedAt).toLocaleString()}
        </Text>
      </View>
    </TouchableBounce>
  );
}

const inputStyle = {
  backgroundColor: AC.systemBackground,
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 10,
  borderColor: AC.separator,
  borderWidth: 1,
  color: AC.label,
};
