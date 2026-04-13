import { db } from "../db/sqlite";
import type { Thread, ThreadStatus } from "../types/domain";
import { createId } from "../utils/ids";

const threadColumns =
  "id, title, repoName, status, updatedAt, lastMessagePreview, remoteSessionId, workDir, createdAt";

const mapRow = (row: any): Thread => ({
  id: row.id,
  title: row.title,
  repoName: row.repoName,
  status: row.status,
  updatedAt: row.updatedAt,
  lastMessagePreview: row.lastMessagePreview,
  remoteSessionId: row.remoteSessionId ?? undefined,
  workDir: row.workDir ?? "",
  createdAt: row.createdAt,
});

export const threadService = {
  list(): Thread[] {
    const rows = db
      .prepare(
        `SELECT ${threadColumns} FROM threads ORDER BY datetime(updatedAt) DESC`
      )
      .all();
    return rows.map(mapRow);
  },

  get(threadId: string): Thread | undefined {
    const row = db
      .prepare(`SELECT ${threadColumns} FROM threads WHERE id = ?`)
      .get(threadId);
    if (!row) return undefined;
    return mapRow(row);
  },

  create(input: { title: string; workDir?: string }): Thread {
    const now = new Date().toISOString();
    const id = createId("thr");
    db.prepare(
      `INSERT INTO threads (id, title, repoName, status, updatedAt, lastMessagePreview, workDir, createdAt)
       VALUES (@id, @title, @repoName, @status, @updatedAt, @lastMessagePreview, @workDir, @createdAt)`
    ).run({
      id,
      title: input.title,
      repoName: "",
      status: "idle",
      updatedAt: now,
      lastMessagePreview: "",
      workDir: input.workDir ?? "",
      createdAt: now,
    });
    return this.get(id)!;
  },

  setStatus(threadId: string, status: ThreadStatus) {
    db.prepare(
      `UPDATE threads SET status = @status, updatedAt = @updatedAt WHERE id = @threadId`
    ).run({ status, updatedAt: new Date().toISOString(), threadId });
  },

  updatePreview(threadId: string, preview: string) {
    db.prepare(
      `UPDATE threads SET lastMessagePreview = @preview, updatedAt = @updatedAt WHERE id = @threadId`
    ).run({
      preview,
      threadId,
      updatedAt: new Date().toISOString(),
    });
  },

  setRemoteSession(threadId: string, remoteSessionId: string) {
    db.prepare(
      `UPDATE threads SET remoteSessionId = @remoteSessionId WHERE id = @threadId`
    ).run({ remoteSessionId, threadId });
  },

  delete(threadId: string): boolean {
    db.prepare("DELETE FROM messages WHERE threadId = ?").run(threadId);
    const result = db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
    return result.changes > 0;
  },

  /** Count messages belonging to a thread. */
  messageCount(threadId: string): number {
    const row = db
      .prepare("SELECT COUNT(*) as n FROM messages WHERE threadId = ?")
      .get(threadId) as { n: number };
    return row?.n ?? 0;
  },

  duplicate(threadId: string): Thread | undefined {
    const source = this.get(threadId);
    if (!source) return undefined;

    const now = new Date().toISOString();
    const newId = createId("thr");

    db.prepare(
      `INSERT INTO threads (id, title, repoName, status, updatedAt, lastMessagePreview, workDir, createdAt)
       VALUES (@id, @title, @repoName, @status, @updatedAt, @lastMessagePreview, @workDir, @createdAt)`
    ).run({
      id: newId,
      title: source.title + " (copy)",
      repoName: "",
      status: "idle",
      updatedAt: now,
      lastMessagePreview: source.lastMessagePreview ?? "",
      workDir: source.workDir ?? "",
      createdAt: now,
    });

    // Copy all messages into the new thread
    const messages = db
      .prepare("SELECT * FROM messages WHERE threadId = ? ORDER BY datetime(createdAt) ASC")
      .all(threadId) as any[];

    const insertMsg = db.prepare(
      `INSERT INTO messages (id, threadId, role, content, createdAt)
       VALUES (@id, @threadId, @role, @content, @createdAt)`
    );
    for (const msg of messages) {
      insertMsg.run({
        id: createId("msg"),
        threadId: newId,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
      });
    }

    return this.get(newId);
  },
};
