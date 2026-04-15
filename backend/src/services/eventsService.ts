import { db } from "../db/sqlite";
import { logger } from "../utils/logger";

/**
 * Structured telemetry for the chat system. Every backend decision
 * (spawn, tool call, token usage, compact, error) and every SSE emission
 * is recorded here so we can reconstruct exactly what happened during a
 * run and compare it against what the client rendered.
 *
 * The schema is intentionally loose — `payload` is a JSON blob — so new
 * event types don't require migrations.
 */

export type EventSource = "runtime" | "stream" | "route" | "client";

export type RecordInput = {
  source: EventSource;
  type: string;
  threadId?: string | null;
  runId?: string | null;
  payload: Record<string, unknown>;
};

export type EventRow = {
  id: number;
  ts: number;
  source: EventSource;
  type: string;
  threadId: string | null;
  runId: string | null;
  payload: Record<string, unknown>;
};

const insertStmt = db.prepare(`
  INSERT INTO events (ts, source, type, threadId, runId, payload)
  VALUES (@ts, @source, @type, @threadId, @runId, @payload)
`);

const queryAll = db.prepare(`
  SELECT id, ts, source, type, threadId, runId, payload
  FROM events
  WHERE (@threadId IS NULL OR threadId = @threadId)
    AND (@type IS NULL OR type = @type)
    AND (@source IS NULL OR source = @source)
    AND (@since IS NULL OR ts >= @since)
  ORDER BY ts DESC
  LIMIT @limit
`);

const deleteByThread = db.prepare(`DELETE FROM events WHERE threadId = ?`);

export const eventsService = {
  record(input: RecordInput): void {
    try {
      insertStmt.run({
        ts: Date.now(),
        source: input.source,
        type: input.type,
        threadId: input.threadId ?? null,
        runId: input.runId ?? null,
        payload: JSON.stringify(input.payload),
      });
    } catch (err) {
      // Never let telemetry throw up into the hot path.
      logger.warn({ err, type: input.type }, "eventsService.record failed");
    }
  },

  /**
   * Batched insert for client-side events. Wrapped in a transaction so
   * a 50-event flush is one fsync, not 50.
   */
  recordBatch(inputs: RecordInput[]): number {
    if (inputs.length === 0) return 0;
    const ts = Date.now();
    const tx = db.transaction((rows: RecordInput[]) => {
      for (const r of rows) {
        insertStmt.run({
          ts,
          source: r.source,
          type: r.type,
          threadId: r.threadId ?? null,
          runId: r.runId ?? null,
          payload: JSON.stringify(r.payload),
        });
      }
    });
    try {
      tx(inputs);
      return inputs.length;
    } catch (err) {
      logger.warn({ err, count: inputs.length }, "eventsService.recordBatch failed");
      return 0;
    }
  },

  query(opts: {
    threadId?: string;
    type?: string;
    source?: EventSource;
    since?: number;
    limit?: number;
  }): EventRow[] {
    const rows = queryAll.all({
      threadId: opts.threadId ?? null,
      type: opts.type ?? null,
      source: opts.source ?? null,
      since: opts.since ?? null,
      limit: Math.min(Math.max(opts.limit ?? 200, 1), 5000),
    }) as Array<Omit<EventRow, "payload"> & { payload: string }>;

    return rows.map((r) => ({
      ...r,
      payload: safeParse(r.payload),
    }));
  },

  deleteForThread(threadId: string): number {
    try {
      return deleteByThread.run(threadId).changes;
    } catch (err) {
      logger.warn({ err, threadId }, "eventsService.deleteForThread failed");
      return 0;
    }
  },
};

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { _parseError: true, raw };
  }
}
