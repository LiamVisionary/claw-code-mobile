import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { IconSymbol, type IconSymbolName } from "@/components/ui/IconSymbol";
import { BORDER_RADIUS, SHADOW, SPACING, TYPOGRAPHY } from "@/constants/theme";
import { usePalette } from "@/hooks/usePalette";
import { useGatewayStore, type FsEntry, type FsListing } from "@/store/gatewayStore";
import {
  normalizeServerUrlForMatch,
  selectQueueForBackend,
} from "@/store/queueScope";

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

function stripFileScheme(pathOrUri: string): string {
  return pathOrUri.replace(/^file:\/\//, "").replace(/\/$/, "");
}

// Mirrors the backend `/fs/browse` response shape using expo-file-system so
// on-device threads can list their in-sandbox workspace without a network
// round trip. Hidden files are filtered and dirs sort first — matches the
// server behavior exactly so downstream render code stays identical.
async function browseLocalDirectory(dirPath: string): Promise<FsListing> {
  const uri = dirPath.startsWith("file://") ? dirPath : `file://${dirPath}`;
  const trimmedUri = uri.replace(/\/$/, "");
  const names = await FileSystem.readDirectoryAsync(trimmedUri);
  const entries: FsEntry[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const childUri = `${trimmedUri}/${name}`;
    try {
      const info = await FileSystem.getInfoAsync(childUri);
      entries.push({
        name,
        path: stripFileScheme(childUri),
        isDir: info.isDirectory ?? false,
      });
    } catch {
      // A transient stat failure on one child shouldn't wipe the listing.
    }
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const plain = stripFileScheme(trimmedUri);
  const lastSlash = plain.lastIndexOf("/");
  const parent = lastSlash > 0 ? plain.slice(0, lastSlash) : null;
  return { path: plain, parent, entries };
}

const MAX_ENTRIES = 40;
const DEFAULT_ON_DEVICE_WORKSPACE_SUBDIR = "claw-workspace";

export default function FileMentionPicker({ visible, workDir, query, onTag }: Props) {
  const palette = usePalette();
  const browseFsDirectory = useGatewayStore((s) => s.actions.browseFsDirectory);
  // True when the first enabled model on the active backend is on-device —
  // same selection the send path uses, so the picker and the LLM agree on
  // which filesystem is authoritative for this thread.
  const isOnDevice = useGatewayStore((s) => {
    const normalized = normalizeServerUrlForMatch(s.settings.serverUrl);
    const scoped = selectQueueForBackend(s.settings.modelQueue ?? [], normalized);
    return (scoped[0]?.provider as string | undefined) === "on-device";
  });
  const anim = useRef(new Animated.Value(0)).current;

  // Resolve the effective workspace root.
  //
  // On-device mode: always use `<documentDirectory>/claw-workspace`. The
  // thread's `workDir` is commonly a backend/desktop path (e.g. the Mac
  // repo root picked via DirectoryBrowser) which is outside the app
  // sandbox and unreadable via expo-file-system. The on-device `read`
  // tool operates on the sandbox workspace, so anchoring the picker
  // there keeps what the user browses and what the LLM can actually
  // read in sync.
  //
  // Backend mode: trust `workDir` as-is — that's a server-side path the
  // `/fs/browse` endpoint can resolve.
  const effectiveWorkDir = useMemo(() => {
    if (isOnDevice) {
      const base = FileSystem.documentDirectory?.replace(/\/$/, "");
      if (!base) return "";
      return stripFileScheme(`${base}/${DEFAULT_ON_DEVICE_WORKSPACE_SUBDIR}`);
    }
    return stripFileScheme(workDir?.trim() ?? "");
  }, [workDir, isOnDevice]);

  // Picker's own internal navigation — starts at workDir, user can drill in.
  const [currentPath, setCurrentPath] = useState(effectiveWorkDir);
  const [listing, setListing] = useState<FsListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to workDir root whenever the picker opens fresh. We check `visible`
  // and `workDir` — leaving the picker open and re-opening elsewhere should
  // always land the user at the root rather than wherever they last drilled to.
  useEffect(() => {
    if (visible) setCurrentPath(effectiveWorkDir);
  }, [visible, effectiveWorkDir]);

  // First-ever on-device use: the default workspace subdir may not exist
  // yet (the runner creates it lazily at send-time). Pre-create it so the
  // picker can list immediately instead of surfacing a stat error.
  useEffect(() => {
    if (!isOnDevice || !effectiveWorkDir) return;
    FileSystem.makeDirectoryAsync(`file://${effectiveWorkDir}`, {
      intermediates: true,
    }).catch(() => {
      // Dir already exists or can't be created — either way, let the
      // subsequent `readDirectoryAsync` surface the real problem.
    });
  }, [isOnDevice, effectiveWorkDir]);

  const load = useCallback(
    async (target: string) => {
      if (!target) return;
      setLoading(true);
      setError(null);
      try {
        // On-device: the workspace lives in the app sandbox, so the backend
        // has no view into it. Go straight to expo-file-system.
        const res = isOnDevice
          ? await browseLocalDirectory(target)
          : await browseFsDirectory(target);
        setListing(res);
      } catch (e: any) {
        setError(e?.message ?? "Cannot read directory");
      } finally {
        setLoading(false);
      }
    },
    [browseFsDirectory, isOnDevice]
  );

  useEffect(() => {
    if (!visible) return;
    if (!currentPath) return;
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

  const atRoot = currentPath === effectiveWorkDir;
  const crumb = atRoot ? "." : joinRel(effectiveWorkDir, currentPath);

  const goUp = () => {
    if (atRoot) return;
    const parent = listing?.parent;
    if (!parent) return;
    setCurrentPath(parent);
  };

  const tagEntry = (entry: FsEntry) => {
    const rel = joinRel(effectiveWorkDir, entry.path);
    const ref = rel === "" ? "." : rel;
    onTag(entry.isDir ? ref + "/" : ref);
  };

  const tagCurrentDir = () => {
    const rel = joinRel(effectiveWorkDir, currentPath);
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
