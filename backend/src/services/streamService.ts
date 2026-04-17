import type { Response } from "express";
import { StreamEvent } from "../types/domain";
import { eventsService } from "./eventsService";
import { logger } from "../utils/logger";

type Client = {
  res: Response;
  threadId: string;
};

type BufferedEvent = {
  ts: number;
  event: StreamEvent;
};

const subscribers = new Map<string, Set<Client>>();

/**
 * Per-thread replay buffer. SSE subscribers dying mid-run and reconnecting
 * is the norm (iOS network stack, cloudflared flow-control, proxies)…
 * reconnect loses any events that fired between close and re-subscribe
 * unless we replay them. We keep the most recent N state-mutating events
 * per thread; delta events (text chunks) are intentionally NOT buffered
 * because they're re-synced from SQLite via `refreshThread → loadMessages`
 * on reconnect, and replaying them would double-append.
 */
const REPLAY_BUFFER_LIMIT = 500;
const replayBuffers = new Map<string, BufferedEvent[]>();

const REPLAYABLE_TYPES = new Set<StreamEvent["type"]>([
  "tool_start",
  "tool_end",
  "thinking_content",
  "run_phase",
  "status",
  "compact_start",
  "compact_end",
  "permission_request",
  "done",
  "error",
  "message_error",
] as StreamEvent["type"][]);

function addToReplayBuffer(threadId: string, event: StreamEvent) {
  if (!REPLAYABLE_TYPES.has(event.type)) return;
  let buf = replayBuffers.get(threadId);
  if (!buf) {
    buf = [];
    replayBuffers.set(threadId, buf);
  }
  buf.push({ ts: Date.now(), event });
  if (buf.length > REPLAY_BUFFER_LIMIT) {
    buf.splice(0, buf.length - REPLAY_BUFFER_LIMIT);
  }
  // When a run ends, drop everything so the next run starts fresh.
  if (event.type === "done" || (event.type === "status" && (event as { status?: string }).status === "idle")) {
    // Retain only a small tail (5 events) so a very fast reconnect after
    // run-end still sees the closing status/done.
    if (buf.length > 5) buf.splice(0, buf.length - 5);
  }
}

/**
 * Truncate a stream event to a bounded-size structure suitable for event
 * logging — keeps type + messageId + content length + a 400-char preview of
 * any string fields so we can diff what was sent against what the client
 * rendered without storing megabytes of text per run.
 */
function truncateEventForLog(ev: StreamEvent): Record<string, unknown> {
  const out: Record<string, unknown> = { type: ev.type };
  const obj = ev as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (k === "type") continue;
    if (typeof v === "string") {
      out[k + "Len"] = v.length;
      out[k] = v.length > 400 ? v.slice(0, 400) + "…" : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Pad every event with a 16 KB SSE comment line. Cloudflared + RN XHR
// buffer small HTTP/2 DATA frames until a size threshold is reached (we
// measured ~60 KB batches in practice). Padding each event past HTTP/2's
// default 16 KB DATA frame size forces immediate flushing — every event
// gets its own frame, no waiting for batch-fill. SSE comments (lines
// starting with `:`) are ignored by a spec-compliant parser.
const SSE_PAD = ": " + " ".repeat(16384) + "\n";
const format = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n${SSE_PAD}\n`;

export const streamService = {
  subscribe(threadId: string, res: Response) {
    eventsService.record({
      source: "stream",
      type: "sse_subscribe",
      threadId,
      payload: {},
    });
    res.setHeader("Content-Type", "text/event-stream");
    // `no-transform` tells intermediaries not to rewrite the body;
    // `X-Accel-Buffering: no` is the de-facto signal to nginx / cloudflared /
    // most HTTP proxies to disable response buffering. The 16 KB per-event
    // padding above is the primary fix, but these headers are cheap hygiene
    // and help other proxy tiers honor the streaming contract.
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    // Disable Nagle's on the Node → cloudflared socket so small writes go
    // out immediately instead of waiting for coalescing.
    res.socket?.setNoDelay(true);
    // Large initial preamble primes any downstream buffer.
    res.write(SSE_PAD + "\n");

    const client: Client = { res, threadId };
    const existing = subscribers.get(threadId) ?? new Set<Client>();
    existing.add(client);
    subscribers.set(threadId, existing);

    // Replay buffered state-mutating events so a reconnecting client sees
    // tool badges, compact progress, permission requests, and run phase
    // transitions that fired while it was offline. Text deltas are NOT
    // replayed here (would double-append); the client's reconnect handler
    // calls `refreshThread` which re-fetches canonical message content.
    const buf = replayBuffers.get(threadId);
    if (buf && buf.length > 0) {
      eventsService.record({
        source: "stream",
        type: "sse_replay",
        threadId,
        payload: { count: buf.length },
      });
      for (const { event } of buf) {
        try {
          res.write(format(event.type, event));
        } catch { /* socket died mid-replay — cleanup below */ }
      }
    }

    // Keep-alive pings every 15s so idle HTTP/2 streams don't get torn
    // down by cloudflared / intermediaries during quiet periods.
    const keepAlive = setInterval(() => {
      try {
        res.write(SSE_PAD + "\n");
      } catch { /* socket already gone — cleanup below */ }
    }, 15000);

    res.on("close", () => {
      clearInterval(keepAlive);
      eventsService.record({
        source: "stream",
        type: "sse_unsubscribe",
        threadId,
        payload: {},
      });
      this.unsubscribe(threadId, client);
    });
  },

  unsubscribe(threadId: string, client: Client) {
    const current = subscribers.get(threadId);
    if (!current) return;
    current.delete(client);
    if (current.size === 0) {
      subscribers.delete(threadId);
    }
  },

  sendTo(res: Response, event: StreamEvent) {
    const payload = format(event.type, event);
    try {
      res.write(payload);
    } catch { /* client already gone */ }
  },

  publish(threadId: string, event: StreamEvent) {
    // Buffer BEFORE checking subscribers so reconnects still see events
    // that fired while the connection was down.
    addToReplayBuffer(threadId, event);

    const clients = subscribers.get(threadId);
    const subCount = clients?.size ?? 0;
    // Record every emission, including the ones that get dropped because
    // nobody is subscribed — dropped events are the #1 cause of the UI
    // getting stuck on "thinking…" so being able to find them in the log
    // is worth the write volume.
    eventsService.record({
      source: "stream",
      type: "sse_publish",
      threadId,
      payload: {
        eventType: event.type,
        subscribers: subCount,
        dropped: subCount === 0,
        buffered: REPLAYABLE_TYPES.has(event.type),
        event: truncateEventForLog(event),
      },
    });
    if (!clients || clients.size === 0) return;
    const payload = format(event.type, event);
    // Critical events (done, status, error) must reach the client
    // immediately — if they sit in a proxy/tunnel buffer the UI stays
    // stuck on "responding…" for up to 77s. Write extra padding and
    // call flush() to push through any intermediary.
    const isCritical =
      event.type === "done" ||
      event.type === "status" ||
      event.type === "error" ||
      event.type === "message_error";
    const dead: Client[] = [];
    for (const client of clients) {
      try {
        client.res.write(payload);
        if (isCritical) {
          // Extra 32 KB nudge to exceed any buffering threshold
          client.res.write(SSE_PAD + SSE_PAD + "\n");
          if (typeof (client.res as any).flush === "function") {
            (client.res as any).flush();
          }
        }
      } catch (err) {
        logger.warn({ err, threadId }, "SSE write failed — removing dead subscriber");
        dead.push(client);
      }
    }
    // Prune dead clients outside the iteration loop
    for (const client of dead) {
      this.unsubscribe(threadId, client);
      try { client.res.destroy(); } catch { /* already destroyed */ }
    }
  },
};
