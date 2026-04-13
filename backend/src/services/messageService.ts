import { db } from "../db/sqlite";
import type { Message } from "../types/domain";
import { createId } from "../utils/ids";
import { threadService } from "./threadService";

const messageColumns = "id, threadId, role, content, createdAt";

const mapRow = (row: any): Message => ({
  id: row.id,
  threadId: row.threadId,
  role: row.role,
  content: row.content,
  createdAt: row.createdAt,
});

export const messageService = {
  list(threadId: string): Message[] {
    const rows = db
      .prepare(
        `SELECT ${messageColumns} FROM messages WHERE threadId = ? ORDER BY datetime(createdAt) ASC`
      )
      .all(threadId);
    return rows.map(mapRow);
  },

  addUserMessage(threadId: string, content: string): Message {
    const id = createId("msg");
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO messages (id, threadId, role, content, createdAt)
       VALUES (@id, @threadId, 'user', @content, @createdAt)`
    ).run({ id, threadId, content, createdAt });
    threadService.updatePreview(threadId, content.slice(0, 180));
    return this.get(id)!;
  },

  ensureAssistantMessage(threadId: string, messageId: string): Message {
    const existing = this.get(messageId);
    if (existing) return existing;
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO messages (id, threadId, role, content, createdAt)
       VALUES (@id, @threadId, 'assistant', '', @createdAt)`
    ).run({ id: messageId, threadId, createdAt });
    return this.get(messageId)!;
  },

  appendAssistantDelta(
    threadId: string,
    messageId: string,
    chunk: string
  ): Message {
    const message = this.ensureAssistantMessage(threadId, messageId);
    const updated = message.content + chunk;
    db.prepare(
      `UPDATE messages SET content = @content WHERE id = @id`
    ).run({ content: updated, id: messageId });
    threadService.updatePreview(threadId, updated.slice(-180));
    return { ...message, content: updated };
  },

  finalizeAssistant(threadId: string, messageId: string): Message | null {
    const message = this.get(messageId);
    if (!message) return null; // no content was ever written — leave no ghost bubble
    if (!message.content.trim()) {
      // Empty assistant message — delete it so it never appears as a blank bubble
      db.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
      return null;
    }
    threadService.updatePreview(threadId, message.content.slice(-180));
    return message;
  },

  get(messageId: string): Message | undefined {
    const row = db
      .prepare(`SELECT ${messageColumns} FROM messages WHERE id = ?`)
      .get(messageId);
    if (!row) return undefined;
    return mapRow(row);
  },
};
