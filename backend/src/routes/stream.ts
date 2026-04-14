import { Router } from "express";
import { clawRuntime, getRunPhase } from "../runtime/clawRuntime";
import { streamService } from "../services/streamService";
import { threadService } from "../services/threadService";
import { runService } from "../services/runService";
import { HttpError } from "../utils/errors";

export const streamRouter = Router();

streamRouter.get("/threads/:threadId/stream", (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) {
      throw new HttpError(404, "Thread not found");
    }
    streamService.subscribe(thread.id, res);
    const phase = getRunPhase(thread.id);
    streamService.sendTo(res, { type: "status", status: thread.status });
    streamService.sendTo(res, { type: "run_phase", phase });
  } catch (err) {
    next(err);
  }
});

streamRouter.get("/threads/:threadId/run-state", (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) {
      throw new HttpError(404, "Thread not found");
    }
    const phase = getRunPhase(thread.id);
    const activeRun = runService.getActive(thread.id);
    res.json({
      status: thread.status,
      phase,
      runId: activeRun?.id ?? null,
    });
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
