import { db } from "../db/sqlite";
import type { Run, RunStatus } from "../types/domain";
import { createId } from "../utils/ids";

const runColumns = "id, threadId, status, startedAt, finishedAt";

const mapRow = (row: any): Run => ({
  id: row.id,
  threadId: row.threadId,
  status: row.status,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt ?? undefined,
});

export const runService = {
  start(threadId: string): Run {
    const id = createId("run");
    const startedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO runs (id, threadId, status, startedAt) VALUES (@id, @threadId, 'running', @startedAt)`
    ).run({ id, threadId, startedAt });
    return this.get(id)!;
  },

  get(id: string): Run | undefined {
    const row = db.prepare(`SELECT ${runColumns} FROM runs WHERE id = ?`).get(id);
    if (!row) return undefined;
    return mapRow(row);
  },

  getActive(threadId: string): Run | undefined {
    const row = db
      .prepare(
        `SELECT ${runColumns} FROM runs WHERE threadId = ? AND status = 'running' ORDER BY datetime(startedAt) DESC LIMIT 1`
      )
      .get(threadId);
    if (!row) return undefined;
    return mapRow(row);
  },

  markStatus(id: string, status: RunStatus) {
    const finishedAt =
      status === "done" || status === "stopped" || status === "error"
        ? new Date().toISOString()
        : null;
    db.prepare(
      `UPDATE runs SET status = @status, finishedAt = COALESCE(@finishedAt, finishedAt) WHERE id = @id`
    ).run({ id, status, finishedAt });
  },
};
