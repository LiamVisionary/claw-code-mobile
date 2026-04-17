import fs from "fs";
import path from "path";
import os from "os";
import type { Note, NoteListing, VaultProvider, VaultValidation } from "./types";

const MD_EXT = ".md";

function expandHome(input: string): string {
  if (input.startsWith("~")) {
    return path.join(os.homedir(), input.slice(1));
  }
  return input;
}

function resolveVaultRoot(vaultPath: string): string {
  return path.resolve(expandHome(vaultPath.trim()));
}

/**
 * Guard against path traversal: every vault-relative path the caller hands us
 * must resolve to something inside the vault root. We reject `..` segments
 * and absolute paths outright rather than relying on `resolve` + `startsWith`
 * alone, since a symlink inside the vault could still escape.
 */
function joinSafe(root: string, rel: string): string {
  const normalized = path.posix.normalize(rel.replace(/\\/g, "/"));
  if (path.isAbsolute(normalized) || normalized.startsWith("..") || normalized.includes("\0")) {
    throw new Error(`Invalid vault path: ${rel}`);
  }
  return path.join(root, normalized);
}

function titleFromPath(rel: string): string {
  const base = path.basename(rel, MD_EXT);
  return base;
}

async function walkMarkdown(root: string, subdir = ""): Promise<string[]> {
  const start = subdir ? joinSafe(root, subdir) : root;
  if (!fs.existsSync(start)) return [];
  const out: string[] = [];
  const stack: string[] = [start];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith(MD_EXT)) {
        out.push(abs);
      }
    }
  }
  return out;
}

/**
 * Scan common locations for Obsidian vaults. An Obsidian vault is any directory
 * containing a `.obsidian/` subfolder.
 */
export async function detectVaults(): Promise<
  { path: string; name: string; noteCount: number }[]
> {
  const home = os.homedir();
  const candidates = [
    // Common vault parent directories
    home,
    path.join(home, "Documents"),
    path.join(home, "Obsidian"),
    path.join(home, "obsidian"),
    path.join(home, "vaults"),
    path.join(home, "Notes"),
    path.join(home, "notes"),
    // iCloud / Dropbox / OneDrive common sync roots
    path.join(home, "Library/Mobile Documents/iCloud~md~obsidian/Documents"),
    path.join(home, "Dropbox"),
    path.join(home, "OneDrive/Documents"),
  ];

  const found: { path: string; name: string; noteCount: number }[] = [];
  const seen = new Set<string>();

  for (const dir of candidates) {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        const realFull = path.resolve(full);
        if (seen.has(realFull)) continue;
        const obsidianDir = path.join(full, ".obsidian");
        try {
          const stat = await fs.promises.stat(obsidianDir);
          if (stat.isDirectory()) {
            seen.add(realFull);
            const mdFiles = await walkMarkdown(full);
            found.push({
              path: realFull,
              name: entry.name,
              noteCount: mdFiles.length,
            });
          }
        } catch {
          // No .obsidian/ — not a vault, skip
        }
      }
    } catch {
      // Directory doesn't exist or isn't readable — skip
    }
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export function createFilesystemVault(vaultPath: string): VaultProvider {
  const root = resolveVaultRoot(vaultPath);

  const relativize = (abs: string): string =>
    path.relative(root, abs).split(path.sep).join("/");

  return {
    async validate(): Promise<VaultValidation> {
      if (!vaultPath || !vaultPath.trim()) {
        return { ok: false, reason: "Vault path is empty." };
      }
      try {
        const stat = await fs.promises.stat(root);
        if (!stat.isDirectory()) {
          return { ok: false, reason: "Path is not a directory.", resolvedPath: root };
        }
        const files = await walkMarkdown(root);
        return { ok: true, noteCount: files.length, resolvedPath: root };
      } catch (err: any) {
        return {
          ok: false,
          reason: err?.code === "ENOENT" ? "Directory does not exist." : err?.message ?? "Cannot read vault.",
          resolvedPath: root,
        };
      }
    },

    async listNotes(subdir?: string): Promise<NoteListing[]> {
      const files = await walkMarkdown(root, subdir);
      const listings = await Promise.all(
        files.map(async (abs) => {
          const stat = await fs.promises.stat(abs);
          const rel = relativize(abs);
          return {
            path: rel,
            title: titleFromPath(rel),
            updatedAt: stat.mtime.toISOString(),
          };
        })
      );
      return listings.sort((a, b) => a.path.localeCompare(b.path));
    },

    async readNote(relPath: string): Promise<Note | null> {
      const abs = joinSafe(root, relPath);
      try {
        const [content, stat] = await Promise.all([
          fs.promises.readFile(abs, "utf8"),
          fs.promises.stat(abs),
        ]);
        return {
          path: relativize(abs),
          title: titleFromPath(relPath),
          content,
          updatedAt: stat.mtime.toISOString(),
        };
      } catch (err: any) {
        if (err?.code === "ENOENT") return null;
        throw err;
      }
    },

    async writeNote(relPath: string, content: string): Promise<Note> {
      const abs = joinSafe(root, relPath);
      await fs.promises.mkdir(path.dirname(abs), { recursive: true });
      await fs.promises.writeFile(abs, content, "utf8");
      const stat = await fs.promises.stat(abs);
      return {
        path: relativize(abs),
        title: titleFromPath(relPath),
        content,
        updatedAt: stat.mtime.toISOString(),
      };
    },

    async appendNote(relPath: string, chunk: string): Promise<Note> {
      const abs = joinSafe(root, relPath);
      await fs.promises.mkdir(path.dirname(abs), { recursive: true });
      const existing = fs.existsSync(abs) ? await fs.promises.readFile(abs, "utf8") : "";
      const joiner = existing && !existing.endsWith("\n") ? "\n" : "";
      const next = existing + joiner + chunk;
      await fs.promises.writeFile(abs, next, "utf8");
      const stat = await fs.promises.stat(abs);
      return {
        path: relativize(abs),
        title: titleFromPath(relPath),
        content: next,
        updatedAt: stat.mtime.toISOString(),
      };
    },
  };
}
