import { Router } from "express";
import { z } from "zod";
import { shellService } from "../services/shellService";
import { terminalService } from "../services/terminalService";
import { threadService } from "../services/threadService";
import { HttpError } from "../utils/errors";

export const terminalRouter = Router();

terminalRouter.get("/threads/:threadId/terminal", (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) {
      throw new HttpError(404, "Thread not found");
    }
    const lines = terminalService.getHistory(thread.id);
    res.json({
      lines,
      shellActive: shellService.isActive(thread.id),
    });
  } catch (err) {
    next(err);
  }
});

terminalRouter.post("/threads/:threadId/terminal", (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) {
      throw new HttpError(404, "Thread not found");
    }
    const body = z
      .object({
        command: z.string().min(1).max(65536),
      })
      .parse(req.body);
    shellService.run(thread.id, body.command);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

terminalRouter.post("/threads/:threadId/terminal/stdin", (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) {
      throw new HttpError(404, "Thread not found");
    }
    const body = z
      .object({
        data: z.string().min(1).max(65536),
      })
      .parse(req.body);
    shellService.sendStdin(thread.id, body.data);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

terminalRouter.post("/threads/:threadId/terminal/interrupt", (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) {
      throw new HttpError(404, "Thread not found");
    }
    const ok = shellService.interrupt(thread.id);
    res.json({ ok });
  } catch (err) {
    next(err);
  }
});

terminalRouter.post("/threads/:threadId/terminal/kill", (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) {
      throw new HttpError(404, "Thread not found");
    }
    const ok = shellService.kill(thread.id);
    res.json({ ok });
  } catch (err) {
    next(err);
  }
});

terminalRouter.get("/threads/:threadId/terminal/snapshot", (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) {
      throw new HttpError(404, "Thread not found");
    }
    const lines = shellService.snapshotSinceLastCommand(thread.id);
    res.json({ lines });
  } catch (err) {
    next(err);
  }
});
