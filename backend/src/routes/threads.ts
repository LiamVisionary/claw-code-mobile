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
        title: z.string().min(1),
        repoName: z.string().min(1),
      })
      .parse(req.body);
    const thread = threadService.create({
      title: body.title,
      repoName: body.repoName,
    });
    res.status(201).json({ thread });
  } catch (err) {
    next(err instanceof HttpError ? err : err);
  }
});
