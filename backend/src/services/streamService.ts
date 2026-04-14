import type { Response } from "express";
import { StreamEvent } from "../types/domain";
import { logger } from "../utils/logger";

type Client = {
  res: Response;
  threadId: string;
};

const subscribers = new Map<string, Set<Client>>();

const format = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export const streamService = {
  subscribe(threadId: string, res: Response) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(":\n\n"); // initial comment for proxies

    const client: Client = { res, threadId };
    const existing = subscribers.get(threadId) ?? new Set<Client>();
    existing.add(client);
    subscribers.set(threadId, existing);

    res.on("close", () => {
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
    const clients = subscribers.get(threadId);
    if (!clients || clients.size === 0) return;
    const payload = format(event.type, event);
    const dead: Client[] = [];
    for (const client of clients) {
      try {
        const ok = client.res.write(payload);
        // write() returns false when the buffer is full (back-pressure), but
        // that's normal and doesn't mean the client is gone. A thrown error
        // means the socket is actually dead — remove it immediately.
        void ok;
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
