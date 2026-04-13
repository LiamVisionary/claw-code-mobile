import cors from "cors";
import express from "express";
import { applyMigrations } from "./db/schema";
import { authMiddleware } from "./middleware/auth";
import { healthRouter } from "./routes/health";
import { messagesRouter } from "./routes/messages";
import { streamRouter } from "./routes/stream";
import { terminalRouter } from "./routes/terminal";
import { threadsRouter } from "./routes/threads";
import { HttpError } from "./utils/errors";
import { logger } from "./utils/logger";

applyMigrations();

export const app = express();

app.use(cors());
app.use(express.json());
app.use(authMiddleware);

app.use(healthRouter);
app.use(threadsRouter);
app.use(messagesRouter);
app.use(streamRouter);
app.use(terminalRouter);

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
