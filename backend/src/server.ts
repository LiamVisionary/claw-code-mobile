import { env } from "./config/env";
import { app } from "./app";
import { logger } from "./utils/logger";

app.listen(env.port, () => {
  logger.info({ port: env.port }, "Gateway server listening");
});
