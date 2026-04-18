import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { FlatList } from "react-native-gesture-handler";
import { useRouter, Link } from "expo-router";
import { useFocusEffect } from "expo-router";
import Swipeable from "react-native-gesture-handler/Swipeable";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { GlassButton } from "@/components/ui/GlassButton";
import { useGatewayStore } from "@/store/gatewayStore";
import type { Thread } from "@/store/gatewayStore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Stack } from "expo-router";
import { IconSymbol } from "@/components/ui/IconSymbol";
import DirectoryBrowser from "@/components/DirectoryBrowser";
import { VaultNotesPane } from "@/components/VaultNotesPane";
import { usePalette } from "@/hooks/usePalette";
import type { Palette } from "@/constants/palette";
import { GlassView } from "expo-glass-effect";

// ─── Right-side swipe actions (Rename + Duplicate + Delete) ─────────────────

const ACTION_WIDTH = 72;

function RightActions({
  onDelete,
  onDuplicate,
  onRename,
  palette,
}: {
  onDelete: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  palette: Palette;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "stretch" }}>
      <TouchableBounce sensory onPress={onRename}>
        <View style={{ width: ACTION_WIDTH, flex: 1, backgroundColor: palette.textSoft, alignItems: "center", justifyContent: "center", gap: 4 }}>
          <IconSymbol name="pencil" color="#fff" size={18} />
          <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>Rename</Text>
        </View>
      </TouchableBounce>
      <TouchableBounce sensory onPress={onDuplicate}>
        <View style={{ width: ACTION_WIDTH, flex: 1, backgroundColor: palette.accent, alignItems: "center", justifyContent: "center", gap: 4 }}>
          <IconSymbol name="doc.on.doc" color="#fff" size={18} />
          <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>Duplicate</Text>
        </View>
      </TouchableBounce>
      <TouchableBounce sensory onPress={onDelete}>
        <View style={{ width: ACTION_WIDTH, flex: 1, backgroundColor: palette.danger, alignItems: "center", justifyContent: "center", gap: 4 }}>
          <IconSymbol name="trash" color="#fff" size={18} />
          <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>Delete</Text>
        </View>
      </TouchableBounce>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ChatListScreen() {
  const router = useRouter();
  const { threads, loadingThreads, _hasHydrated } = useGatewayStore();
  const actions = useGatewayStore((s) => s.actions);
  const obsidianVault = useGatewayStore((s) => s.settings.obsidianVault);
  const projects = useGatewayStore((s) => s.projects);
  const activeProject = useGatewayStore((s) => s.activeProject);
  const threadProject = useGatewayStore((s) => s.threadProject);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const [view, setView] = useState<"chats" | "notes">("chats");
  const { top, bottom } = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const palette = usePalette();
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  // Only show the Chats/Notes toggle when the user has actually connected
  // a vault. Enabled-but-unconfigured states (e.g. toggle flipped on with
  // no path or URI) don't qualify — the Notes pane would just be empty.
  const showNotesToggle = Boolean(
    obsidianVault?.enabled &&
      (((obsidianVault.provider === "backend" || obsidianVault.provider === "sync") && obsidianVault.path) ||
        (obsidianVault.provider === "local" && obsidianVault.localDirectoryUri))
  );

  // If the user disables the vault while sitting on the Notes view, fall
  // back to Chats so the screen doesn't render an empty pane.
  useEffect(() => {
    if (!showNotesToggle && view === "notes") setView("chats");
  }, [showNotesToggle, view]);

  useEffect(() => {
    if (!_hasHydrated) return;
    actions
      .loadThreads()
      .then(() => setError(null))
      .catch((err) => setError(err.message));
  }, [_hasHydrated, actions]);

  useFocusEffect(
    useCallback(() => {
      if (_hasHydrated) {
        actions
          .loadThreads()
          .then(() => setError(null))
          .catch(() => {});
      }
    }, [_hasHydrated, actions])
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && _hasHydrated) {
        actions
          .loadThreads()
          .then(() => setError(null))
          .catch(() => {});
      }
    });
    return () => sub.remove();
  }, [_hasHydrated, actions]);

  const sortedThreads = [...threads]
    .filter((t) => {
      const tp = threadProject[t.id] || "";
      return tp === activeProject;
    })
    .sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

  const activeProjectLabel = activeProject || "General";
  const allProjects = ["", ...projects]; // "" = General

  const handleNewProject = () => {
    setShowProjectPicker(false);
    Alert.prompt(
      "New project",
      "Enter a name",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Create",
          onPress: (name?: string) => {
            const trimmed = name?.trim();
            if (!trimmed) return;
            if (projects.includes(trimmed)) {
              Alert.alert("Already exists", `"${trimmed}" is already a project.`);
              return;
            }
            actions.addProject(trimmed);
            actions.setActiveProject(trimmed);
          },
        },
      ],
      "plain-text"
    );
  };

  const handleNewChat = () => setShowBrowser(true);

  const handleDirectorySelected = async (selectedPath: string) => {
    setShowBrowser(false);
    setCreating(true);
    setError(null);
    try {
      // Remember this directory for next time
      const s = useGatewayStore.getState().settings;
      actions.setSettings({ ...s, lastWorkDir: selectedPath });
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

  const handleRename = (thread: Thread) => {
    Alert.prompt(
      "Rename conversation",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: (newTitle?: string) => {
            if (newTitle && newTitle.trim()) {
              actions.renameThread(thread.id, newTitle.trim()).catch(() => {
                setError("Failed to rename conversation.");
              });
            }
          },
        },
      ],
      "plain-text",
      thread.title
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <TouchableBounce sensory onPress={() => setShowProjectPicker((v) => !v)}>
              <View style={{ alignItems: "center" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Text
                    style={{
                      fontSize: 17,
                      fontWeight: "600",
                      color: palette.text,
                      letterSpacing: -0.4,
                    }}
                    numberOfLines={1}
                  >
                    {activeProjectLabel}
                  </Text>
                  <IconSymbol name="chevron.down" size={11} color={palette.textMuted} />
                </View>
                {showNotesToggle && (
                  <View style={{ flexDirection: "row", marginTop: 4 }}>
                    {(["chats", "notes"] as const).map((key) => {
                      const selected = view === key;
                      return (
                        <TouchableBounce
                          key={key}
                          sensory
                          onPress={(e) => {
                            e.stopPropagation?.();
                            setView(key);
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: "500",
                              color: selected ? palette.accent : palette.textMuted,
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                            }}
                          >
                            {key === "chats" ? "Chats" : "Notes"}
                          </Text>
                        </TouchableBounce>
                      );
                    })}
                  </View>
                )}
              </View>
            </TouchableBounce>
          ),
          headerLeft: () => (
            <Link href="/settings" asChild>
              <TouchableBounce sensory>
                <View style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center" }}>
                  <IconSymbol name="gear" color={palette.textMuted} size={20} />
                </View>
              </TouchableBounce>
            </Link>
          ),
          headerRight: () => (
            <TouchableBounce sensory onPress={handleNewChat} disabled={creating}>
              <View style={{ width: 34, height: 34, alignItems: "center", justifyContent: "center", opacity: creating ? 0.5 : 1 }}>
                {creating ? (
                  <ActivityIndicator color={palette.textMuted} size="small" />
                ) : (
                  <IconSymbol name="plus" color={palette.text} size={20} />
                )}
              </View>
            </TouchableBounce>
          ),
        }}
      />
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {error && (
          <Text
            style={{
              position: "absolute",
              top: headerHeight + 8,
              left: 0,
              right: 0,
              zIndex: 10,
              color: palette.danger,
              fontSize: 13,
              paddingHorizontal: 24,
            }}
          >
            {error}
          </Text>
        )}

        {/* ── Project picker dropdown (liquid glass) ── */}
        {/* Rendered in a Modal so it sits above the native nav bar —
            a zIndex on content can't outrank the header's iOS layer. */}
        <Modal
          visible={showProjectPicker}
          transparent
          animationType="none"
          onRequestClose={() => setShowProjectPicker(false)}
        >
          <Pressable
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            onPress={() => setShowProjectPicker(false)}
          />
          <View
            style={{
              position: "absolute",
              top: headerHeight - 24,
              left: 0,
              right: 0,
              alignItems: "center",
            }}
          >
              <GlassView
                glassEffectStyle="regular"
                style={{
                  borderRadius: 16,
                  overflow: "hidden",
                  minWidth: 220,
                  maxWidth: 320,
                  paddingVertical: 6,
                }}
              >
                {allProjects.map((p, i) => {
                  const label = p || "General";
                  const selected = p === activeProject;
                  return (
                    <View key={label}>
                      {i > 0 && (
                        <View
                          style={{
                            height: 1,
                            marginLeft: 18,
                            backgroundColor: palette.divider,
                            opacity: 0.5,
                          }}
                        />
                      )}
                      <Pressable
                        onPress={() => { actions.setActiveProject(p); setShowProjectPicker(false); }}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          paddingHorizontal: 18,
                          paddingVertical: 12,
                          backgroundColor: pressed ? palette.surfaceAlt : "transparent",
                        })}
                      >
                        <Text
                          style={{
                            flex: 1,
                            fontSize: 15,
                            fontWeight: selected ? "600" : "400",
                            color: palette.text,
                            letterSpacing: -0.1,
                          }}
                          numberOfLines={1}
                        >
                          {label}
                        </Text>
                        {selected && (
                          <IconSymbol
                            name="checkmark"
                            size={14}
                            color={palette.text}
                          />
                        )}
                      </Pressable>
                    </View>
                  );
                })}
                <View
                  style={{
                    height: 1,
                    marginLeft: 18,
                    backgroundColor: palette.divider,
                    opacity: 0.5,
                  }}
                />
                <Pressable
                  onPress={handleNewProject}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingHorizontal: 18,
                    paddingVertical: 12,
                    backgroundColor: pressed ? palette.surfaceAlt : "transparent",
                  })}
                >
                  <IconSymbol name="plus" size={14} color={palette.textMuted} />
                  <Text
                    style={{
                      fontSize: 15,
                      color: palette.text,
                      letterSpacing: -0.1,
                    }}
                  >
                    New project
                  </Text>
                </Pressable>
              </GlassView>
            </View>
        </Modal>

        {view === "notes" ? (
          <VaultNotesPane palette={palette} />
        ) : !_hasHydrated || (loadingThreads && threads.length === 0) ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={palette.textSoft} />
          </View>
        ) : (
          <FlatList
            data={sortedThreads}
            keyExtractor={(item) => item.id}
            contentInsetAdjustmentBehavior="automatic"
            automaticallyAdjustsScrollIndicatorInsets
            contentContainerStyle={{
              paddingTop: 8,
              paddingBottom: bottom + 24,
              flexGrow: 1,
            }}
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
              <SwipeableChatRow
                thread={item}
                onPress={() => {
                  actions.setActiveThread(item.id);
                  router.push(`/thread/${item.id}`);
                }}
                onDelete={() => handleDelete(item)}
                onDeleteImmediate={() => {
                  actions.deleteThread(item.id).catch(() => {
                    setError("Failed to delete conversation.");
                  });
                }}
                onDuplicate={() => handleDuplicate(item)}
                onRename={() => handleRename(item)}
                palette={palette}
              />
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
                    fontSize: 22,
                    fontWeight: "500",
                    letterSpacing: -0.3,
                  }}
                >
                  No conversations yet
                </Text>
                <Text
                  style={{
                    color: palette.textMuted,
                    fontSize: 15,
                    textAlign: "center",
                    lineHeight: 22,
                    marginBottom: 20,
                  }}
                >
                  Start a chat to begin working with Claw in a project directory.
                </Text>
                <GlassButton
                  onPress={handleNewChat}
                  disabled={creating}
                  style={{ paddingHorizontal: 28, paddingVertical: 13, borderRadius: 14 }}
                >
                  <Text
                    style={{
                      color: palette.text,
                      fontWeight: "600",
                      fontSize: 15,
                      letterSpacing: -0.1,
                    }}
                  >
                    New conversation
                  </Text>
                </GlassButton>
              </View>
            )}
          />
        )}
      </View>

      <DirectoryBrowser
        visible={showBrowser}
        initialPath={useGatewayStore.getState().settings.lastWorkDir}
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
  onRename,
  palette,
}: {
  thread: Thread;
  onPress: () => void;
  onDelete: () => void;
  onDeleteImmediate?: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  palette: Palette;
}) {
  const swipeRef = useRef<Swipeable>(null);
  const close = () => swipeRef.current?.close();

  return (
    <Swipeable
      ref={swipeRef}
      friction={1.5}
      overshootRight={false}
      rightThreshold={20}
      renderRightActions={() => (
        <RightActions
          onDelete={() => { close(); onDelete(); }}
          onDuplicate={() => { close(); onDuplicate(); }}
          onRename={() => { close(); onRename(); }}
          palette={palette}
        />
      )}
    >
      <ChatRow thread={thread} onPress={onPress} palette={palette} />
    </Swipeable>
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
    <View style={{ backgroundColor: palette.bg }}>
    <TouchableBounce sensory onPress={onPress}>
      <View
        style={{
          paddingHorizontal: 24,
          paddingVertical: 18,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text
            style={{
              color: palette.text,
              fontSize: 16,
              fontWeight: "500",
              letterSpacing: -0.2,
              flex: 1,
            }}
            numberOfLines={1}
          >
            {thread.title}
          </Text>
          {isRunning && (
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 3.5,
                backgroundColor: palette.accent,
              }}
            />
          )}
          <Text style={{ color: palette.textSoft, fontSize: 12 }}>
            {timeAgo(thread.updatedAt)}
          </Text>
        </View>

        {thread.lastMessagePreview ? (
          <Text
            style={{
              color: palette.textMuted,
              fontSize: 14,
              lineHeight: 20,
            }}
            numberOfLines={2}
          >
            {thread.lastMessagePreview}
          </Text>
        ) : (
          <Text style={{ color: palette.textSoft, fontSize: 14 }}>
            No messages yet
          </Text>
        )}

        {dirName && (
          <Text
            style={{
              color: palette.textSoft,
              fontSize: 11,
              marginTop: 2,
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              letterSpacing: -0.1,
            }}
            numberOfLines={1}
          >
            {dirName}
          </Text>
        )}
      </View>
    </TouchableBounce>
    </View>
  );
}
