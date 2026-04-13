import path from "node:path";
import { z } from "zod";

const schema = z.object({
  PORT: z.string().optional(),
  GATEWAY_AUTH_TOKEN: z.string().optional(),
  DATABASE_FILE: z.string().optional(),
  DATA_DIR: z.string().optional(),
});

const parsed = schema.parse(process.env);

const dataDir = parsed.DATA_DIR
  ? path.resolve(parsed.DATA_DIR)
  : path.resolve(process.cwd(), "data");

export const env = {
  port: Number(parsed.PORT ?? 5000),
  authToken: parsed.GATEWAY_AUTH_TOKEN ?? "dev-token",
  databasePath: path.resolve(
    parsed.DATABASE_FILE ?? path.join(dataDir, "gateway.db")
  ),
  dataDir,
};
