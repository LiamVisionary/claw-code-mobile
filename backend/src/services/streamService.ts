import type { Response } from "express";
import { StreamEvent } from "../types/domain";
import { logger } from "../utils/logger";

type Client = {
  res: Response;
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

    const client: Client = { res };
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

  publish(threadId: string, event: StreamEvent) {
    const clients = subscribers.get(threadId);
    if (!clients || clients.size === 0) return;
    const payload = format(event.type, event);
    for (const client of clients) {
      try {
        client.res.write(payload);
      } catch (err) {
        logger.warn({ err }, "Failed to write SSE event");
      }
    }
  },
};
