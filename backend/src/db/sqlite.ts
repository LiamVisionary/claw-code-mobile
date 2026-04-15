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

// Apply schema as a side-effect of this module. Services imported elsewhere
// (eventsService, messageService, …) prepare statements at module-load time,
// which means the tables they reference must exist *before* those modules
// evaluate. Running migrations here — at the single shared DB init point —
// guarantees anything that imports `db` sees a migrated schema.
import { applyMigrations } from "./schema";
applyMigrations();

logger.info({ databasePath: env.databasePath }, "SQLite database ready");
