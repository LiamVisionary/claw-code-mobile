import { db } from "../db/sqlite";
import type { Message, MessageMetadata } from "../types/domain";
import { createId } from "../utils/ids";
import { threadService } from "./threadService";

const messageColumns =
  "id, threadId, role, content, createdAt, error, model, tokensIn, tokensOut, costUsd, turnDurationMs, planMode, reasoningEffort, metadata";

const parseMetadata = (raw: unknown): MessageMetadata | undefined => {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const mapRow = (row: any): Message => {
  const metadata = parseMetadata(row.metadata);
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
    ...(row.error ? { error: true } : {}),
    ...(row.model ? { model: row.model as string } : {}),
    ...(row.tokensIn != null ? { tokensIn: row.tokensIn as number } : {}),
    ...(row.tokensOut != null ? { tokensOut: row.tokensOut as number } : {}),
    ...(row.costUsd != null ? { costUsd: row.costUsd as number } : {}),
    ...(row.turnDurationMs != null
      ? { turnDurationMs: row.turnDurationMs as number }
      : {}),
    ...(row.planMode ? { planMode: row.planMode as "act" | "plan" } : {}),
    ...(row.reasoningEffort
      ? { reasoningEffort: row.reasoningEffort as "low" | "medium" | "high" }
      : {}),
    ...(metadata ? { metadata } : {}),
  };
};

export interface TurnTelemetry {
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  turnDurationMs?: number;
  planMode?: "act" | "plan";
  reasoningEffort?: "low" | "medium" | "high";
  metadata?: MessageMetadata;
}

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

  addSystemMessage(threadId: string, content: string): Message {
    const id = createId("msg");
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO messages (id, threadId, role, content, createdAt)
       VALUES (@id, @threadId, 'system', @content, @createdAt)`
    ).run({ id, threadId, content, createdAt });
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

  setTurnTelemetry(messageId: string, telemetry: TurnTelemetry) {
    const meta = telemetry.metadata;
    const metaHasAny =
      !!meta &&
      (meta.thinking ||
        (meta.turnLog && meta.turnLog.length > 0) ||
        (meta.toolSteps && meta.toolSteps.length > 0));
    const metadataJson = metaHasAny ? JSON.stringify(meta) : null;
    db.prepare(
      `UPDATE messages
       SET model           = @model,
           tokensIn        = @tokensIn,
           tokensOut       = @tokensOut,
           costUsd         = @costUsd,
           turnDurationMs  = @turnDurationMs,
           planMode        = @planMode,
           reasoningEffort = @reasoningEffort,
           metadata        = @metadata
       WHERE id = @id`
    ).run({
      id: messageId,
      model: telemetry.model ?? null,
      tokensIn: telemetry.tokensIn ?? null,
      tokensOut: telemetry.tokensOut ?? null,
      costUsd: telemetry.costUsd ?? null,
      turnDurationMs: telemetry.turnDurationMs ?? null,
      planMode: telemetry.planMode ?? null,
      reasoningEffort: telemetry.reasoningEffort ?? null,
      metadata: metadataJson,
    });
  },

  markError(_threadId: string, messageId: string) {
    db.prepare(`UPDATE messages SET error = 1 WHERE id = @id`).run({ id: messageId });
  },

  get(messageId: string): Message | undefined {
    const row = db
      .prepare(`SELECT ${messageColumns} FROM messages WHERE id = ?`)
      .get(messageId);
    if (!row) return undefined;
    return mapRow(row);
  },
};
