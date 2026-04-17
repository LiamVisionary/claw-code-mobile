import { env } from "./config/env";
import { app } from "./app";
import { shellService } from "./services/shellService";
import { logger } from "./utils/logger";

const server = app.listen(env.port, () => {
  logger.info({ port: env.port }, "Gateway server listening");
});

// Graceful shutdown — kill any spawned user shells so bash children don't
// outlive the parent. Without this, tsx watch-restarts accumulate orphaned
// shells that keep holding onto the thread's workDir.
const shutdown = (signal: string) => {
  logger.info({ signal }, "Shutting down — killing user shells");
  shellService.shutdownAll();
  server.close(() => {
    process.exit(0);
  });
  // Hard-exit fallback if server.close hangs on an open SSE stream.
  setTimeout(() => process.exit(0), 2000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
