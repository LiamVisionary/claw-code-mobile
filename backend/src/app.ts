import cors from "cors";
import express from "express";
import { db } from "./db/sqlite";
import { authMiddleware } from "./middleware/auth";
import { eventsRouter } from "./routes/events";
import { fsRouter } from "./routes/fs";
import { healthRouter } from "./routes/health";
import { openAppRouter } from "./routes/openApp";
import { messagesRouter } from "./routes/messages";
import { streamRouter } from "./routes/stream";
import { terminalRouter } from "./routes/terminal";
import { threadsRouter } from "./routes/threads";
import { HttpError } from "./utils/errors";
import { logger } from "./utils/logger";

// Schema migrations run automatically from db/sqlite.ts so services can
// prepare statements at import time.

const stuckCount = db
  .prepare(`UPDATE threads SET status = 'error' WHERE status IN ('running', 'waiting')`)
  .run().changes;
if (stuckCount > 0) {
  logger.info({ stuckCount }, "Reset stuck threads on startup");
}

export const app = express();

app.use(cors());
app.use(express.json());
app.use(authMiddleware);

app.use(healthRouter);
app.use(openAppRouter);
app.use(threadsRouter);
app.use(fsRouter);
app.use(messagesRouter);
app.use(streamRouter);
app.use(terminalRouter);
app.use(eventsRouter);

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
