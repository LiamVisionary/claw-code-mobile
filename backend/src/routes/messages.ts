import { Router } from "express";
import { z } from "zod";
import { clawRuntime } from "../runtime/clawRuntime";
import { messageService } from "../services/messageService";
import { threadService } from "../services/threadService";
import { HttpError } from "../utils/errors";
import { createId } from "../utils/ids";
import { logger } from "../utils/logger";

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
  authMethod: z.enum(["apiKey", "oauth"]).optional(),
  oauthToken: z
    .object({
      accessToken: z.string(),
      refreshToken: z.string().optional(),
      expiresAt: z.number().optional(),
      scopes: z.array(z.string()).optional(),
    })
    .optional(),
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
        autoCompactThreshold: z.number().min(0).max(100).optional(),
        streamingEnabled: z.boolean().optional(),
        autoContinueEnabled: z.boolean().optional(),
        attachments: z
          .array(
            z.object({
              path: z.string(),
              fileName: z.string(),
              relativePath: z.string(),
              kind: z.enum(["image", "file"]),
              mimeType: z.string().optional(),
              size: z.number().optional(),
            })
          )
          .optional(),
      })
      .parse(req.body);

    const models = body.modelQueue?.length
      ? (body.modelQueue as any[])
      : body.model
      ? [body.model as any]
      : [];

    messageService.addUserMessage(thread.id, body.content);
    const assistantMessageId = createId("msg");

    // Respond immediately so the mobile client isn't blocked waiting for the
    // entire claw run to finish. The run executes in the background and pushes
    // progress over the SSE stream.
    res.status(202).json({ ok: true });

    clawRuntime
      .sendMessage(
        thread.id,
        body.content,
        assistantMessageId,
        models,
        body.autoCompact ?? true,
        body.streamingEnabled ?? true,
        body.autoCompactThreshold ?? 70,
        body.autoContinueEnabled ?? true,
        body.attachments ?? []
      )
      .catch((err: unknown) => {
        logger.error({ err }, "clawRuntime.sendMessage failed");
      });
  } catch (err) {
    next(err);
  }
});
