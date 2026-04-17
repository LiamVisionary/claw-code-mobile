import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

/**
 * Mobile-side vault access (scenario 1 — vault stored on the phone). This
 * is read-only by design: the backend can't reach back into the phone's
 * filesystem, so memory writes only work for scenario 2 (backend vault).
 *
 * The abstraction here mirrors `backend/src/services/vault/types.ts`
 * without trying to share code — the file-access primitives on mobile
 * (`StorageAccessFramework`, security-scoped document URIs) are different
 * enough from Node's `fs` that a shared interface would paper over real
 * differences and leak.
 */

export type LocalNote = { path: string; title: string; content: string };

/**
 * A listing entry for the Notes pane. `uri` is the opaque identifier used
 * to re-read the note later (SAF content URI on Android, file:// URL on
 * iOS). `path` is a display-friendly relative path.
 */
export type LocalNoteListing = { uri: string; path: string; title: string };

export type PickResult =
  | { ok: true; directoryUri: string; displayPath: string }
  | { ok: false; reason: string };

export type LocalValidation =
  | { ok: true; noteCount: number; displayPath: string }
  | { ok: false; reason: string };

const MD_EXT = ".md";
const MEMORY_SUBDIR = "claw-code/memory";

function displayPathFromUri(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    const treeMarker = "/tree/";
    const idx = decoded.indexOf(treeMarker);
    if (idx !== -1) {
      return decoded.slice(idx + treeMarker.length);
    }
    return decoded;
  } catch {
    return uri;
  }
}

/**
 * Prompt the user to pick a vault folder. On Android this uses the Storage
 * Access Framework (stable, persistent). On iOS we fall back to the
 * document picker in folder mode — this only works on iOS 14+ and requires
 * the vault to be accessible via the Files app (iCloud Drive or "On My
 * iPhone"). The SAF-equivalent doesn't exist on iOS.
 */
export async function pickVaultDirectory(): Promise<PickResult> {
  if (Platform.OS === "android") {
    try {
      const perm =
        await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: "Permission denied." };
      return {
        ok: true,
        directoryUri: perm.directoryUri,
        displayPath: displayPathFromUri(perm.directoryUri),
      };
    } catch (err: any) {
      return { ok: false, reason: err?.message ?? "Picker failed." };
    }
  }

  // iOS — folder picker via expo-document-picker. The resulting URI is a
  // security-scoped bookmark; read access persists for the app session but
  // may need re-picking after a reboot depending on iOS version.
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: false,
      multiple: false,
    });
    if (res.canceled || !res.assets?.[0]) {
      return { ok: false, reason: "Picker cancelled." };
    }
    const asset = res.assets[0];
    return {
      ok: true,
      directoryUri: asset.uri,
      displayPath: asset.name ?? displayPathFromUri(asset.uri),
    };
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? "Picker failed." };
  }
}

/**
 * List direct `.md` files under the vault or a subdirectory. Does not
 * recurse — for memory we only need files directly inside
 * `claw-code/memory/`, and full-vault recursion is noisy on SAF.
 */
async function listMarkdownFiles(directoryUri: string, subdir?: string): Promise<string[]> {
  // Android SAF path
  if (Platform.OS === "android" && directoryUri.startsWith("content://")) {
    try {
      let target = directoryUri;
      if (subdir) {
        target = await resolveSubdirSaf(directoryUri, subdir);
        if (!target) return [];
      }
      const entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(target);
      return entries.filter((u) => u.toLowerCase().endsWith(MD_EXT));
    } catch {
      return [];
    }
  }

  // iOS / file:// fallback
  if (directoryUri.startsWith("file://")) {
    const base = subdir ? `${directoryUri.replace(/\/$/, "")}/${subdir}` : directoryUri;
    try {
      const entries = await FileSystem.readDirectoryAsync(base);
      return entries
        .filter((n) => n.toLowerCase().endsWith(MD_EXT))
        .map((n) => `${base.replace(/\/$/, "")}/${n}`);
    } catch {
      return [];
    }
  }

  return [];
}

/**
 * Resolve a `claw-code/memory` style subpath under a SAF tree URI by
 * walking children. Returns the child tree URI or null if missing.
 */
async function resolveSubdirSaf(treeUri: string, subdir: string): Promise<string | null> {
  const parts = subdir.split("/").filter(Boolean);
  let current = treeUri;
  for (const part of parts) {
    try {
      const children = await FileSystem.StorageAccessFramework.readDirectoryAsync(current);
      const match = children.find((c) => {
        const decoded = decodeURIComponent(c);
        return decoded.endsWith(`/${part}`) || decoded.endsWith(`%2F${part}`);
      });
      if (!match) return null;
      current = match;
    } catch {
      return null;
    }
  }
  return current;
}

export async function validateLocalVault(directoryUri: string): Promise<LocalValidation> {
  if (!directoryUri) return { ok: false, reason: "No folder selected." };
  try {
    const files = await listMarkdownFiles(directoryUri);
    return {
      ok: true,
      noteCount: files.length,
      displayPath: displayPathFromUri(directoryUri),
    };
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? "Cannot read folder." };
  }
}

/**
 * Recursively list every `.md` file reachable from the vault root. Used
 * by the Notes pane on the chat list screen. Results are returned with a
 * best-effort vault-relative display path so the UI can show a breadcrumb.
 */
export async function listAllLocalNotes(directoryUri: string): Promise<LocalNoteListing[]> {
  if (!directoryUri) return [];
  const out: LocalNoteListing[] = [];

  // Android SAF — walk tree URIs recursively.
  if (Platform.OS === "android" && directoryUri.startsWith("content://")) {
    type Frame = { uri: string; relParts: string[] };
    const stack: Frame[] = [{ uri: directoryUri, relParts: [] }];
    while (stack.length) {
      const frame = stack.pop()!;
      let entries: string[];
      try {
        entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(frame.uri);
      } catch {
        continue;
      }
      for (const entryUri of entries) {
        const decoded = decodeURIComponent(entryUri);
        const name = decoded.split("/").pop() ?? entryUri;
        if (name.startsWith(".")) continue;
        if (name.toLowerCase().endsWith(MD_EXT)) {
          const relParts = [...frame.relParts, name];
          const rel = relParts.join("/");
          out.push({
            uri: entryUri,
            path: rel,
            title: name.replace(/\.md$/i, ""),
          });
        } else {
          // SAF doesn't give us a reliable "isDirectory" flag on the URI
          // alone, so we try to list it and skip on error. This is the
          // expo-file-system legacy API's idiomatic way.
          try {
            const children = await FileSystem.StorageAccessFramework.readDirectoryAsync(entryUri);
            // readDirectoryAsync only succeeds on directories.
            if (children) {
              stack.push({ uri: entryUri, relParts: [...frame.relParts, name] });
            }
          } catch {
            // not a directory, or unreadable — skip
          }
        }
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  // iOS / file:// — standard FS recursion.
  if (directoryUri.startsWith("file://")) {
    type Frame = { uri: string; relParts: string[] };
    const stack: Frame[] = [{ uri: directoryUri, relParts: [] }];
    while (stack.length) {
      const frame = stack.pop()!;
      let names: string[];
      try {
        names = await FileSystem.readDirectoryAsync(frame.uri);
      } catch {
        continue;
      }
      for (const name of names) {
        if (name.startsWith(".")) continue;
        const childUri = `${frame.uri.replace(/\/$/, "")}/${name}`;
        if (name.toLowerCase().endsWith(MD_EXT)) {
          const rel = [...frame.relParts, name].join("/");
          out.push({ uri: childUri, path: rel, title: name.replace(/\.md$/i, "") });
        } else {
          try {
            const info = await FileSystem.getInfoAsync(childUri);
            if (info.exists && info.isDirectory) {
              stack.push({ uri: childUri, relParts: [...frame.relParts, name] });
            }
          } catch {
            // skip
          }
        }
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  return out;
}

export async function readLocalNoteContent(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri);
}

export async function readLocalMemories(directoryUri: string): Promise<LocalNote[]> {
  const files = await listMarkdownFiles(directoryUri, MEMORY_SUBDIR);
  const notes: LocalNote[] = [];
  for (const fileUri of files) {
    try {
      const content = await FileSystem.readAsStringAsync(fileUri);
      const name = decodeURIComponent(fileUri).split("/").pop() ?? fileUri;
      notes.push({
        path: `${MEMORY_SUBDIR}/${name}`,
        title: name.replace(/\.md$/i, ""),
        content,
      });
    } catch {
      // skip unreadable files rather than failing the whole preamble
    }
  }
  return notes;
}

/**
 * Build the preamble injected into the user's prompt when the local
 * provider is active. Matches the backend's `buildContextPreamble` in
 * spirit, but is explicit that the vault lives on the user's device and
 * writes can't happen through claw.
 */
export async function buildLocalPreamble(
  directoryUri: string,
  useForMemory: boolean,
  useForReference: boolean
): Promise<string | null> {
  if (!directoryUri) return null;
  if (!useForMemory && !useForReference) return null;

  const lines: string[] = [];
  lines.push("[Obsidian vault integration — vault lives on the user's mobile device]");
  lines.push("Access is read-only for this turn: the backend cannot reach back into the device.");
  if (useForReference) {
    lines.push(
      "Reference notes from the user's vault are injected below when relevant."
    );
  }
  if (useForMemory) {
    try {
      const memories = await readLocalMemories(directoryUri);
      if (memories.length > 0) {
        lines.push("");
        lines.push("Current memory contents (read-only snapshot):");
        for (const m of memories) {
          lines.push(`--- ${m.path} ---`);
          lines.push(m.content.trim());
          lines.push("");
        }
      }
    } catch {
      // fall through
    }
  }
  lines.push("[End of vault context]");
  lines.push("");
  return lines.join("\n");
}
