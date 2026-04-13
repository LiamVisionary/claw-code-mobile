import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useGatewayStore, type FsEntry, type FsListing } from "../store/gatewayStore";

type Props = {
  visible: boolean;
  onSelect: (path: string) => void;
  onCancel: () => void;
};

export default function DirectoryBrowser({ visible, onSelect, onCancel }: Props) {
  const browseFsDirectory = useGatewayStore((s) => s.actions.browseFsDirectory);
  const [listing, setListing] = useState<FsListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slideAnim = useRef(new Animated.Value(700)).current;

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
      navigate(undefined);
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

  const breadcrumbs = listing
    ? listing.path
        .split("/")
        .filter(Boolean)
        .map((seg, i, arr) => ({
          label: seg,
          path: "/" + arr.slice(0, i + 1).join("/"),
        }))
    : [];

  const dirs = listing?.entries.filter((e) => e.isDir) ?? [];

  return (
    <Modal
      transparent
      animationType="none"
      visible={visible}
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Choose Working Directory</Text>
            <TouchableOpacity onPress={onCancel} hitSlop={12}>
              <Text style={styles.headerCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>

          {/* Breadcrumb row */}
          <View style={styles.breadcrumbContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.breadcrumbScroll}
            >
              {/* Root "/" chip */}
              <TouchableOpacity
                onPress={() => navigate("/")}
                style={styles.breadcrumbChip}
              >
                <Text style={styles.breadcrumbText}>/</Text>
              </TouchableOpacity>
              {breadcrumbs.map((crumb, i) => (
                <React.Fragment key={crumb.path}>
                  <Text style={styles.breadcrumbSep}>›</Text>
                  <TouchableOpacity
                    onPress={() => navigate(crumb.path)}
                    style={[
                      styles.breadcrumbChip,
                      i === breadcrumbs.length - 1 && styles.breadcrumbActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.breadcrumbText,
                        i === breadcrumbs.length - 1 &&
                          styles.breadcrumbActiveText,
                      ]}
                    >
                      {crumb.label}
                    </Text>
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </ScrollView>
          </View>

          {/* Body */}
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color="#4ade80" />
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => navigate(listing?.path)}
              >
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={dirs}
              keyExtractor={(item) => item.path}
              renderItem={({ item }) => (
                <DirectoryRow
                  item={item}
                  onNavigate={() => navigate(item.path)}
                />
              )}
              ListEmptyComponent={
                <View style={styles.center}>
                  <Text style={styles.emptyText}>No sub-directories</Text>
                </View>
              }
              style={styles.list}
            />
          )}

          {/* Footer */}
          <View style={styles.footer}>
            {listing?.parent != null && (
              <TouchableOpacity
                style={styles.upBtn}
                onPress={() => navigate(listing.parent!)}
              >
                <Text style={styles.upText}>↑ Up</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.selectBtn}
              onPress={() => listing && onSelect(listing.path)}
              disabled={!listing}
            >
              <Text style={styles.selectText}>
                Open Here
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function DirectoryRow({
  item,
  onNavigate,
}: {
  item: FsEntry;
  onNavigate: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onNavigate}>
      <Text style={styles.rowIcon}>📁</Text>
      <Text style={styles.rowName} numberOfLines={1}>
        {item.name}
      </Text>
      <Text style={styles.rowChevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#1a1a2e",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    paddingBottom: Platform.OS === "ios" ? 34 : 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  headerCancel: {
    color: "#4ade80",
    fontSize: 16,
  },
  breadcrumbContainer: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  breadcrumbScroll: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 4,
  },
  breadcrumbChip: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  breadcrumbActive: {
    backgroundColor: "rgba(74,222,128,0.2)",
  },
  breadcrumbText: {
    color: "#aaa",
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  breadcrumbActiveText: {
    color: "#4ade80",
  },
  breadcrumbSep: {
    color: "#555",
    fontSize: 16,
  },
  list: {
    flexGrow: 0,
    maxHeight: 360,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.07)",
  },
  rowIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  rowName: {
    flex: 1,
    color: "#e0e0e0",
    fontSize: 15,
  },
  rowChevron: {
    color: "#555",
    fontSize: 20,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyText: {
    color: "#666",
    fontSize: 14,
  },
  errorText: {
    color: "#f87171",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 12,
  },
  retryBtn: {
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryText: {
    color: "#fff",
  },
  footer: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  upBtn: {
    flex: 0,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  upText: {
    color: "#aaa",
    fontSize: 15,
    fontWeight: "500",
  },
  selectBtn: {
    flex: 1,
    backgroundColor: "#4ade80",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  selectText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "700",
  },
});
