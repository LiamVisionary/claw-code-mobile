export type NoteListing = {
  /** Vault-relative path, always forward-slash. */
  path: string;
  title: string;
  updatedAt: string;
};

export type Note = {
  path: string;
  title: string;
  content: string;
  updatedAt: string;
};

export type VaultValidation = {
  ok: boolean;
  /** Short reason when `ok === false`. */
  reason?: string;
  /** Total number of `.md` files beneath the vault root, when ok. */
  noteCount?: number;
  /** Absolute path the server resolved the vault to. */
  resolvedPath?: string;
};

/**
 * Abstraction over a vault-like note store. The filesystem implementation is
 * the only one shipped today (scenario 2 — vault on the VPS alongside the
 * backend), but the interface is shaped so phone-local and remote Obsidian
 * implementations can slot in later without changing callers.
 */
export interface VaultProvider {
  validate(): Promise<VaultValidation>;
  listNotes(subdir?: string): Promise<NoteListing[]>;
  readNote(relPath: string): Promise<Note | null>;
  writeNote(relPath: string, content: string): Promise<Note>;
  appendNote(relPath: string, content: string): Promise<Note>;
}
