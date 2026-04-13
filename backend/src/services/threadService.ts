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
};
