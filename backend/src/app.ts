import cors from "cors";
import express from "express";
import { db } from "./db/sqlite";
import { authMiddleware } from "./middleware/auth";
import { eventsRouter } from "./routes/events";
import { fsRouter } from "./routes/fs";
import { healthRouter } from "./routes/health";
import { openAppRouter } from "./routes/openApp";
import { messagesRouter } from "./routes/messages";
import { obsidianRouter } from "./routes/obsidian";
import { streamRouter } from "./routes/stream";
import { terminalRouter } from "./routes/terminal";
import { threadsRouter } from "./routes/threads";
import { uploadsRouter } from "./routes/uploads";
import { oauthRouter } from "./routes/oauth";
import { HttpError } from "./utils/errors";
import { logger } from "./utils/logger";

// Schema migrations run automatically from db/sqlite.ts so services can
// prepare statements at import time.

// ── Orphaned run cleanup ─────────────────────────────────────────────
// If the server restarts while a run is active (e.g. tsx hot-reload
// triggered by the claw agent editing a backend file), the in-memory
// activeRuns map is lost and no done/error event is ever sent. Detect
// these orphaned runs and clean them up so threads aren't stuck.
const orphanedRuns: Array<{ id: string; threadId: string }> = db
  .prepare(`SELECT id, threadId FROM runs WHERE status = 'running'`)
  .all() as any[];

if (orphanedRuns.length > 0) {
  const now = new Date().toISOString();
  const markRun = db.prepare(
    `UPDATE runs SET status = 'error', finishedAt = @now WHERE id = @id`
  );
  const appendNotice = db.prepare(
    `UPDATE messages SET content = content || @notice
     WHERE id = (
       SELECT id FROM messages
       WHERE threadId = @threadId AND role = 'assistant'
       ORDER BY createdAt DESC LIMIT 1
     ) AND content != ''`
  );

  for (const run of orphanedRuns) {
    markRun.run({ id: run.id, now });
    appendNotice.run({
      threadId: run.threadId,
      notice: "\n\n---\n*Run interrupted — the server restarted while this response was in progress. Please send a new message to continue.*",
    });
  }

  logger.info(
    { count: orphanedRuns.length, runIds: orphanedRuns.map((r) => r.id) },
    "Cleaned up orphaned runs on startup"
  );
}

const stuckCount = db
  .prepare(`UPDATE threads SET status = 'idle' WHERE status IN ('running', 'waiting', 'error')`)
  .run().changes;
if (stuckCount > 0) {
  logger.info({ stuckCount }, "Reset stuck threads to idle on startup");
}

export const app = express();

app.use(cors());
// 40 MB ceiling covers base64-encoded image uploads from the mobile
// client (the `/threads/:id/upload` route). Non-upload routes still
// send small JSON payloads, so the cap is generous but harmless.
app.use(express.json({ limit: "40mb" }));
app.use(authMiddleware);

app.use(healthRouter);
app.use(openAppRouter);
app.use(threadsRouter);
app.use(fsRouter);
app.use(messagesRouter);
app.use(streamRouter);
app.use(terminalRouter);
app.use(eventsRouter);
app.use(uploadsRouter);
app.use(oauthRouter);
app.use(obsidianRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: any) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err?.message ?? "Internal Server Error";
  if (status >= 500) {
    logger.error({ err }, "Unhandled error");
  }
  res.status(status).json({ error: message });
});

app.use((_, res) => {
  res.status(404).json({ error: "Not found" });
});
