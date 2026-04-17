import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useGatewayStore, type FsEntry, type FsListing } from "../store/gatewayStore";
import { usePalette } from "@/hooks/usePalette";
import type { Palette } from "@/constants/palette";
import { IconSymbol } from "@/components/ui/IconSymbol";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { GlassButton } from "@/components/ui/GlassButton";

type Props = {
  visible: boolean;
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
};

export default function DirectoryBrowser({ visible, initialPath, onSelect, onCancel }: Props) {
  const browseFsDirectory = useGatewayStore((s) => s.actions.browseFsDirectory);
  const [listing, setListing] = useState<FsListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slideAnim = useRef(new Animated.Value(700)).current;
  const palette = usePalette();

  const navigate = useCallback(
    async (path?: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await browseFsDirectory(path);
        setListing(result);
      } catch (e: any) {
        setError(e.message ?? "Cannot open directory");
      } finally {
        setLoading(false);
      }
    },
    [browseFsDirectory]
  );

  useEffect(() => {
    if (visible) {
      navigate(initialPath || undefined);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 60,
        friction: 12,
      }).start();
    } else {
      slideAnim.setValue(700);
      setListing(null);
      setError(null);
    }
  }, [visible]);

  const dirs = listing?.entries.filter((e) => e.isDir) ?? [];

  return (
    <Modal
      transparent
      animationType="none"
      visible={visible}
      onRequestClose={onCancel}
    >
      <View style={{ flex: 1, backgroundColor: "rgba(20,16,10,0.35)", justifyContent: "flex-end" }}>
        <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={onCancel} />
        <Animated.View
          style={{
            backgroundColor: palette.bg,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: "85%",
            paddingBottom: Platform.OS === "ios" ? 34 : 16,
            transform: [{ translateY: slideAnim }],
          }}
        >
          {/* Grabber */}
          <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 4 }}>
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: palette.divider,
              }}
            />
          </View>

          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 24,
              paddingTop: 14,
              paddingBottom: 16,
            }}
          >
            <Text
              style={{
                color: palette.text,
                fontSize: 18,
                fontWeight: "600",
                letterSpacing: -0.3,
              }}
            >
              Working directory
            </Text>
            <Pressable onPress={onCancel} hitSlop={12}>
              <Text style={{ color: palette.textMuted, fontSize: 15 }}>Cancel</Text>
            </Pressable>
          </View>

          {/* Path bar */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              borderTopWidth: 1,
              borderTopColor: palette.divider,
              paddingHorizontal: 16,
              paddingVertical: 10,
              gap: 10,
            }}
          >
            {listing?.parent != null && (
              <TouchableBounce
                sensory
                onPress={() => navigate(listing.parent!)}
              >
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: palette.surfaceAlt,
                  }}
                >
                  <IconSymbol
                    name="chevron.left"
                    color={palette.textMuted}
                    size={13}
                  />
                </View>
              </TouchableBounce>
            )}
            <Pressable
              onPress={() => navigate("/")}
              hitSlop={6}
              style={{ flex: 1, minWidth: 0 }}
            >
              <Text
                style={{
                  color: palette.text,
                  fontSize: 14,
                  fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                  fontWeight: "500",
                  letterSpacing: -0.3,
                }}
                numberOfLines={1}
              >
                {listing?.path ?? "/"}
              </Text>
            </Pressable>
          </View>

          {/* Body */}
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: palette.divider,
              minHeight: 240,
              maxHeight: 420,
            }}
          >
            {loading ? (
              <View style={{ alignItems: "center", justifyContent: "center", padding: 48 }}>
                <ActivityIndicator color={palette.textSoft} />
              </View>
            ) : error ? (
              <View style={{ alignItems: "center", justifyContent: "center", padding: 48 }}>
                <Text
                  style={{
                    color: palette.danger,
                    fontSize: 14,
                    textAlign: "center",
                    marginBottom: 16,
                  }}
                >
                  {error}
                </Text>
                <TouchableBounce sensory onPress={() => navigate(listing?.path)}>
                  <View
                    style={{
                      paddingHorizontal: 20,
                      paddingVertical: 10,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: palette.divider,
                    }}
                  >
                    <Text style={{ color: palette.text, fontSize: 14, fontWeight: "500" }}>
                      Retry
                    </Text>
                  </View>
                </TouchableBounce>
              </View>
            ) : (
              <FlatList
                data={dirs}
                keyExtractor={(item) => item.path}
                renderItem={({ item }) => (
                  <DirectoryRow
                    item={item}
                    onNavigate={() => navigate(item.path)}
                    palette={palette}
                  />
                )}
                ItemSeparatorComponent={() => (
                  <View
                    style={{
                      height: 1,
                      marginLeft: 24,
                      backgroundColor: palette.divider,
                    }}
                  />
                )}
                ListEmptyComponent={
                  <View style={{ alignItems: "center", justifyContent: "center", padding: 48 }}>
                    <Text style={{ color: palette.textSoft, fontSize: 14 }}>
                      No sub-directories
                    </Text>
                  </View>
                }
              />
            )}
          </View>

          {/* Footer */}
          <View
            style={{
              paddingHorizontal: 24,
              paddingTop: 16,
              borderTopWidth: 1,
              borderTopColor: palette.divider,
            }}
          >
            <GlassButton
              onPress={() => listing && onSelect(listing.path)}
              disabled={!listing}
              style={{ borderRadius: 12, paddingVertical: 14, width: "100%", opacity: listing ? 1 : 0.4 }}
            >
              <Text
                style={{
                  color: palette.text,
                  fontSize: 15,
                  fontWeight: "600",
                  letterSpacing: -0.1,
                }}
              >
                Open here
              </Text>
            </GlassButton>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function DirectoryRow({
  item,
  onNavigate,
  palette,
}: {
  item: FsEntry;
  onNavigate: () => void;
  palette: Palette;
}) {
  return (
    <Pressable
      onPress={onNavigate}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 24,
        paddingVertical: 16,
        backgroundColor: pressed ? palette.surfaceAlt : "transparent",
      })}
    >
      <Text
        style={{
          flex: 1,
          color: palette.text,
          fontSize: 15,
          fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
          letterSpacing: -0.1,
        }}
        numberOfLines={1}
      >
        {item.name}
      </Text>
      <IconSymbol name="chevron.right" color={palette.textSoft} size={14} />
    </Pressable>
  );
}
