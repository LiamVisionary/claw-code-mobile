import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { IconSymbol, type IconSymbolName } from "@/components/ui/IconSymbol";
import { BORDER_RADIUS, SHADOW, SPACING, TYPOGRAPHY } from "@/constants/theme";
import { usePalette } from "@/hooks/usePalette";
import { useGatewayStore, type FsEntry, type FsListing } from "@/store/gatewayStore";

interface Props {
  visible: boolean;
  /** Thread's working directory — the root the picker is relative to. */
  workDir: string;
  /** Query extracted from the `@…` token at the cursor (without the `@`). */
  query: string;
  /** Called with a path *relative to workDir* — or an absolute path if the
   *  chosen entry is outside workDir. Folders come back with a trailing `/`. */
  onTag: (relativePath: string) => void;
}

const IMAGE_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".heif", ".svg",
]);

function iconForFile(name: string): IconSymbolName {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  return IMAGE_EXT.has(ext) ? "photo.on.rectangle" : "doc.text";
}

function joinRel(base: string, full: string): string {
  if (full === base) return "";
  const prefix = base.endsWith("/") ? base : base + "/";
  return full.startsWith(prefix) ? full.slice(prefix.length) : full;
}

const MAX_ENTRIES = 40;

export default function FileMentionPicker({ visible, workDir, query, onTag }: Props) {
  const palette = usePalette();
  const browseFsDirectory = useGatewayStore((s) => s.actions.browseFsDirectory);
  const anim = useRef(new Animated.Value(0)).current;

  // Picker's own internal navigation — starts at workDir, user can drill in.
  const [currentPath, setCurrentPath] = useState(workDir);
  const [listing, setListing] = useState<FsListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to workDir root whenever the picker opens fresh. We check `visible`
  // and `workDir` — leaving the picker open and re-opening elsewhere should
  // always land the user at the root rather than wherever they last drilled to.
  useEffect(() => {
    if (visible) setCurrentPath(workDir);
  }, [visible, workDir]);

  const load = useCallback(
    async (target: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await browseFsDirectory(target);
        setListing(res);
      } catch (e: any) {
        setError(e?.message ?? "Cannot read directory");
      } finally {
        setLoading(false);
      }
    },
    [browseFsDirectory]
  );

  useEffect(() => {
    if (!visible) return;
    load(currentPath);
  }, [visible, currentPath, load]);

  useEffect(() => {
    Animated.spring(anim, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      tension: 280,
      friction: 24,
    }).start();
  }, [visible]);

  if (!visible) return null;

  const entries = listing?.entries ?? [];
  const q = query.toLowerCase();
  const filtered = (q
    ? entries.filter((e) => e.name.toLowerCase().includes(q))
    : entries
  ).slice(0, MAX_ENTRIES);

  const atRoot = currentPath === workDir;
  const crumb = atRoot ? "." : joinRel(workDir, currentPath);

  const goUp = () => {
    if (atRoot) return;
    const parent = listing?.parent;
    if (!parent) return;
    setCurrentPath(parent);
  };

  const tagEntry = (entry: FsEntry) => {
    const rel = joinRel(workDir, entry.path);
    const ref = rel === "" ? "." : rel;
    onTag(entry.isDir ? ref + "/" : ref);
  };

  const tagCurrentDir = () => {
    const rel = joinRel(workDir, currentPath);
    onTag(rel === "" ? "./" : rel + "/");
  };

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [
          {
            translateY: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [8, 0],
            }),
          },
        ],
        borderRadius: BORDER_RADIUS.lg,
        overflow: "hidden",
        backgroundColor: palette.surface,
        borderWidth: 1,
        borderColor: palette.divider,
        ...SHADOW.lg,
      }}
    >
      {/* Breadcrumb / up row */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.sm,
          paddingHorizontal: SPACING.md,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: palette.divider,
        }}
      >
        {!atRoot ? (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={goUp}
            hitSlop={8}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              backgroundColor: palette.surfaceAlt,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconSymbol name="arrow.up" size={12} color={palette.text} />
          </TouchableOpacity>
        ) : (
          <View
            style={{
              width: 24,
              height: 24,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconSymbol name="folder" size={12} color={palette.textSoft} />
          </View>
        )}
        <Text
          style={{
            flex: 1,
            fontSize: TYPOGRAPHY.fontSizes.xs,
            color: palette.textMuted,
            fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
          }}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {crumb}
        </Text>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={tagCurrentDir}
          hitSlop={6}
          style={{
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 6,
          }}
        >
          <Text
            style={{
              color: palette.accent,
              fontSize: 11,
              fontWeight: "600",
            }}
          >
            tag this dir
          </Text>
        </TouchableOpacity>
      </View>

      {/* Body: loading / error / empty / list */}
      {loading && !listing ? (
        <View style={{ paddingVertical: 18, alignItems: "center" }}>
          <ActivityIndicator size="small" color={palette.textSoft} />
        </View>
      ) : error ? (
        <View style={{ paddingVertical: 14, paddingHorizontal: SPACING.md }}>
          <Text style={{ color: palette.danger, fontSize: TYPOGRAPHY.fontSizes.xs }}>
            {error}
          </Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ paddingVertical: 14, paddingHorizontal: SPACING.md }}>
          <Text style={{ color: palette.textSoft, fontSize: TYPOGRAPHY.fontSizes.xs }}>
            {entries.length === 0 ? "Empty directory" : "No matches"}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ maxHeight: 260 }}
          keyboardShouldPersistTaps="always"
        >
          {filtered.map((entry, idx) => {
            const isLast = idx === filtered.length - 1;
            const icon: IconSymbolName = entry.isDir ? "folder" : iconForFile(entry.name);
            return (
              <View
                key={entry.path}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  borderBottomWidth: isLast ? 0 : 1,
                  borderBottomColor: palette.divider,
                }}
              >
                {/* Main tap zone */}
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() =>
                    entry.isDir ? setCurrentPath(entry.path) : tagEntry(entry)
                  }
                  style={{
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: SPACING.sm,
                    paddingLeft: SPACING.md,
                    paddingVertical: 10,
                  }}
                >
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: BORDER_RADIUS.sm,
                      backgroundColor: palette.surfaceAlt,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <IconSymbol
                      name={icon}
                      size={14}
                      color={entry.isDir ? palette.accent : palette.textMuted}
                    />
                  </View>
                  <Text
                    style={{
                      flex: 1,
                      fontSize: TYPOGRAPHY.fontSizes.sm,
                      color: palette.text,
                      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                    }}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                  >
                    {entry.name}
                    {entry.isDir ? "/" : ""}
                  </Text>
                </TouchableOpacity>

                {/* Trailing controls — Tag pill (always), chevron on dirs */}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingRight: SPACING.md,
                    paddingLeft: 4,
                  }}
                >
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => tagEntry(entry)}
                    hitSlop={6}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 6,
                      backgroundColor: palette.surfaceAlt,
                    }}
                  >
                    <Text
                      style={{
                        color: palette.accent,
                        fontSize: 11,
                        fontWeight: "600",
                      }}
                    >
                      tag
                    </Text>
                  </TouchableOpacity>
                  {entry.isDir ? (
                    <IconSymbol
                      name="chevron.right"
                      size={12}
                      color={palette.textSoft}
                    />
                  ) : null}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </Animated.View>
  );
}
