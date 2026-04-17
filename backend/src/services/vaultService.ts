import path from "path";
import { createFilesystemVault } from "./vault/filesystemVault";
import type { Note, NoteListing, VaultProvider, VaultValidation } from "./vault/types";

export type VaultConfig = {
  enabled: boolean;
  path: string;
  useForMemory: boolean;
  useForReference: boolean;
  /** Enable mcpvault MCP server — gives the agent rich vault tools
   *  (search, frontmatter, tags, etc.) instead of raw file access. */
  useMcpVault: boolean;
};

/** Subfolder inside the vault where AI-owned memory notes live. */
export const MEMORY_SUBDIR = "claw-code/memory";

export function getProvider(config: Pick<VaultConfig, "path">): VaultProvider {
  return createFilesystemVault(config.path);
}

export async function validate(config: Pick<VaultConfig, "path">): Promise<VaultValidation> {
  return getProvider(config).validate();
}

/**
 * Read every `.md` under the memory subfolder. Missing folder is treated as
 * "no memories yet" — not an error — so a freshly connected vault works
 * without any setup.
 */
export async function readMemories(config: Pick<VaultConfig, "path">): Promise<Note[]> {
  const provider = getProvider(config);
  const listings = await provider.listNotes(MEMORY_SUBDIR);
  const notes = await Promise.all(
    listings.map((l: NoteListing) => provider.readNote(l.path))
  );
  return notes.filter((n: Note | null): n is Note => n !== null);
}

/**
 * Build the string prepended to the user's prompt when Obsidian integration
 * is active. Returns `null` if nothing should be injected (no vault, no
 * memory/reference flags set, empty vault).
 */
export async function buildContextPreamble(config: VaultConfig): Promise<string | null> {
  if (!config.enabled || !config.path) return null;
  if (!config.useForMemory && !config.useForReference) return null;

  const resolvedRoot = path.resolve(config.path.replace(/^~/, process.env.HOME ?? "~"));
  const lines: string[] = [];

  lines.push("[Obsidian vault integration — this session is connected to the user's vault]");
  lines.push(`Vault root: ${resolvedRoot}`);

  if (config.useForReference) {
    lines.push(
      "Reference notes: you may read and search `.md` files under the vault root to ground your answers in the user's own notes."
    );
  }

  if (config.useForMemory) {
    lines.push(
      `Memory: persistent notes about the user and project live at \`${resolvedRoot}/${MEMORY_SUBDIR}/\`. You may read, update, and create \`.md\` files there when you learn something durable (user preferences, project conventions, decisions). Treat these notes the same way you would a memory system: include a one-line \`description\` in frontmatter, and overwrite rather than duplicate when updating existing entries.`
    );
    try {
      const memories = await readMemories(config);
      if (memories.length > 0) {
        lines.push("");
        lines.push("Current memory contents:");
        for (const m of memories) {
          lines.push(`--- ${m.path} ---`);
          lines.push(m.content.trim());
          lines.push("");
        }
      }
    } catch {
      // Vault unreachable mid-run — fall through with instructions only.
    }
  }

  lines.push("[End of vault context]");
  lines.push("");
  return lines.join("\n");
}
