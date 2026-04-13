import { Router } from "express";
import { z } from "zod";
import { threadService } from "../services/threadService";
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
