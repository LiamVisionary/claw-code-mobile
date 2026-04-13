import { Router } from "express";
import { z } from "zod";
import { threadService } from "../services/threadService";
import { streamService } from "../services/streamService";
import { HttpError } from "../utils/errors";

export const threadsRouter = Router();

threadsRouter.get("/threads", (_req, res) => {
  const threads = threadService.list();
  res.json({ threads });
});

threadsRouter.post("/threads", (req, res, next) => {
  try {
    const body = z
      .object({
        title: z.string().optional(),
        workDir: z.string().optional(),
      })
      .parse(req.body);
    const now = new Date();
    const title = body.title?.trim() ||
      now.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const thread = threadService.create({ title, workDir: body.workDir });
    res.status(201).json({ thread });
  } catch (err) {
    next(err instanceof HttpError ? err : err);
  }
});

threadsRouter.patch("/threads/:threadId", (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) throw new HttpError(404, "Thread not found");
    const body = z.object({
      workDir: z.string().optional(),
      title: z.string().optional(),
    }).parse(req.body);
    const updated = threadService.update(req.params.threadId, body);
    res.json({ thread: updated });
  } catch (err) {
    next(err);
  }
});

threadsRouter.delete("/threads/:threadId", (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) throw new HttpError(404, "Thread not found");
    threadService.delete(req.params.threadId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** SSE stream — the mobile app connects here for realtime events. */
threadsRouter.get("/threads/:threadId/stream", (req, res) => {
  const thread = threadService.get(req.params.threadId);
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }
  streamService.subscribe(req.params.threadId, res);
});

/** Duplicate a thread (copy messages, append "(copy)" to title). */
threadsRouter.post("/threads/:threadId/duplicate", (req, res, next) => {
  try {
    const source = threadService.get(req.params.threadId);
    if (!source) throw new HttpError(404, "Thread not found");
    const copy = threadService.duplicate(req.params.threadId);
    if (!copy) throw new HttpError(500, "Duplication failed");
    res.status(201).json({ thread: copy });
  } catch (err) {
    next(err);
  }
});
