import { db } from "../db/sqlite";

export const terminalService = {
  appendChunk(threadId: string, chunk: string) {
    const lines = chunk.split(/\r?\n/).filter((line) => line.length > 0);
    if (!lines.length) return;
    const stmt = db.prepare(
      `INSERT INTO terminal_lines (threadId, line, createdAt) VALUES (@threadId, @line, @createdAt)`
    );
    const createdAt = new Date().toISOString();
    const insertMany = db.transaction((entries: string[]) => {
      for (const line of entries) {
        stmt.run({ threadId, line, createdAt });
      }
    });
    insertMany(lines);
  },

  getHistory(threadId: string): string[] {
    const rows = db
      .prepare(
        `SELECT line FROM terminal_lines WHERE threadId = ? ORDER BY id ASC LIMIT 500`
      )
      .all(threadId) as { line: string }[];
    return rows.map((r) => r.line);
  },
};
