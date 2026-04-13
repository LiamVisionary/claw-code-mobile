import { Router } from "express";
import { clawRuntime } from "../runtime/clawRuntime";
import { streamService } from "../services/streamService";
import { threadService } from "../services/threadService";
import { HttpError } from "../utils/errors";

export const streamRouter = Router();

streamRouter.get("/threads/:threadId/stream", (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) {
      throw new HttpError(404, "Thread not found");
    }
    streamService.subscribe(thread.id, res);
    // Send current status as first event
    streamService.publish(thread.id, { type: "status", status: thread.status });
  } catch (err) {
    next(err);
  }
});

streamRouter.post("/threads/:threadId/stop", async (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) {
      throw new HttpError(404, "Thread not found");
    }
    await clawRuntime.stop(thread.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
