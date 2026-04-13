import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { env } from "../config/env";
import { logger } from "../utils/logger";

if (!fs.existsSync(env.dataDir)) {
  fs.mkdirSync(env.dataDir, { recursive: true });
}

export const db = new Database(env.databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

logger.info({ databasePath: env.databasePath }, "SQLite database ready");
