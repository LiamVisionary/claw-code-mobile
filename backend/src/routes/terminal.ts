import { Router } from "express";
import { z } from "zod";
import { streamService } from "../services/streamService";
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
    res.json({ lines });
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
        command: z.string().min(1),
      })
      .parse(req.body);

    const line = `$ ${body.command}`;
    terminalService.appendChunk(thread.id, line);
    streamService.publish(thread.id, { type: "terminal", chunk: line + "\n" });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
