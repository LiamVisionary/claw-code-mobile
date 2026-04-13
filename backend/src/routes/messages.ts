import { Router } from "express";
import { z } from "zod";
import { clawRuntime } from "../runtime/clawRuntime";
import { messageService } from "../services/messageService";
import { threadService } from "../services/threadService";
import { HttpError } from "../utils/errors";
import { createId } from "../utils/ids";

export const messagesRouter = Router();

messagesRouter.get("/threads/:threadId/messages", (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) throw new HttpError(404, "Thread not found");
    const messages = messageService.list(thread.id);
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

const modelEntrySchema = z.object({
  provider: z.enum(["claude", "openrouter", "local"]).optional(),
  name: z.string().optional(),
  apiKey: z.string().optional(),
});

messagesRouter.post("/threads/:threadId/messages", async (req, res, next) => {
  try {
    const thread = threadService.get(req.params.threadId);
    if (!thread) throw new HttpError(404, "Thread not found");

    const body = z
      .object({
        content: z.string().min(1),
        modelQueue: z.array(modelEntrySchema).optional(),
        model: modelEntrySchema.optional(),
        autoCompact: z.boolean().optional(),
      })
      .parse(req.body);

    const models = body.modelQueue?.length
      ? (body.modelQueue as any[])
      : body.model
      ? [body.model as any]
      : [];

    messageService.addUserMessage(thread.id, body.content);
    const assistantMessageId = createId("msg");
    const runId = await clawRuntime.sendMessage(
      thread.id,
      body.content,
      assistantMessageId,
      models,
      body.autoCompact ?? true
    );

    res.status(202).json({ ok: true, runId });
  } catch (err) {
    next(err);
  }
});
