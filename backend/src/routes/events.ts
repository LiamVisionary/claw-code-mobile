import { Router } from "express";
import { z } from "zod";
import { eventsService, type EventSource } from "../services/eventsService";
import { logger } from "../utils/logger";

export const eventsRouter = Router();

/**
 * GET /events?threadId=&type=&source=&since=&limit=
 * Returns the most recent events matching the filter, newest first.
 * Used for diagnostics — grep the chat system from the outside.
 */
eventsRouter.get("/events", (req, res) => {
  const threadId = typeof req.query.threadId === "string" ? req.query.threadId : undefined;
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const source = typeof req.query.source === "string"
    ? (req.query.source as EventSource)
    : undefined;
  const since = req.query.since ? Number(req.query.since) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const events = eventsService.query({ threadId, type, source, since, limit });
  res.json({ count: events.length, events });
});

/**
 * POST /events/client
 * Batched ingest of client-side telemetry. The mobile client mirrors
 * every SSE event it receives and every bubble it renders, and ships
 * them here in small batches so we can compare backend emission against
 * client reception to catch rendering mismatches.
 */
const clientEventSchema = z.object({
  type: z.string().min(1).max(100),
  threadId: z.string().optional(),
  runId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const clientBatchSchema = z.object({
  events: z.array(clientEventSchema).max(500),
});

eventsRouter.post("/events/client", (req, res) => {
  try {
    const body = clientBatchSchema.parse(req.body);
    const written = eventsService.recordBatch(
      body.events.map((e) => ({
        source: "client" as const,
        type: e.type,
        threadId: e.threadId,
        runId: e.runId,
        payload: (e.payload ?? {}) as Record<string, unknown>,
      }))
    );
    res.json({ ok: true, written });
  } catch (err) {
    logger.warn({ err }, "events/client ingest failed");
    res.status(400).json({ ok: false });
  }
});
