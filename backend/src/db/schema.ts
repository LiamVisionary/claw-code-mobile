import { db } from "./sqlite";

export const applyMigrations = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      repoName TEXT NOT NULL,
      status TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      lastMessagePreview TEXT NOT NULL,
      remoteSessionId TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      threadId TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages(threadId, createdAt);

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      threadId TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      startedAt TEXT NOT NULL,
      finishedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS terminal_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      threadId TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      line TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS terminal_thread_idx ON terminal_lines(threadId, id);

    -- Telemetry / diagnostics. Structured events from both the backend
    -- runtime and the mobile client, so we can diff what the server sent
    -- against what the client rendered and find token-consumption outliers.
    -- Intentionally denormalized: payload is a free-form JSON blob so new
    -- event types don't require migrations.
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,                -- unix millis
      source TEXT NOT NULL,               -- 'runtime' | 'stream' | 'route' | 'client'
      type TEXT NOT NULL,                 -- e.g. 'run_start', 'tool_call', 'client_sse_received'
      threadId TEXT,                      -- nullable for global events
      runId TEXT,                         -- nullable
      payload TEXT NOT NULL               -- JSON-encoded payload
    );
    CREATE INDEX IF NOT EXISTS events_thread_ts_idx ON events(threadId, ts);
    CREATE INDEX IF NOT EXISTS events_type_ts_idx ON events(type, ts);
    CREATE INDEX IF NOT EXISTS events_run_ts_idx ON events(runId, ts);
  `);

  // Additive migrations — safe to re-run (errors ignored if column already exists)
  try { db.exec(`ALTER TABLE threads ADD COLUMN workDir TEXT NOT NULL DEFAULT ''`); } catch {}
  try { db.exec(`ALTER TABLE messages ADD COLUMN error INTEGER NOT NULL DEFAULT 0`); } catch {}
  // Queryable turn fields so aggregate reports (tokens/day, cost/model)
  // don't have to parse every row's JSON blob. NULL until the turn
  // finalizes.
  try { db.exec(`ALTER TABLE messages ADD COLUMN model TEXT`); } catch {}
  try { db.exec(`ALTER TABLE messages ADD COLUMN tokensIn INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE messages ADD COLUMN tokensOut INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE messages ADD COLUMN costUsd REAL`); } catch {}
  try { db.exec(`ALTER TABLE messages ADD COLUMN turnDurationMs INTEGER`); } catch {}
  // Display-only metadata blob: thinking text, tool steps, turn log.
  // Stored as a JSON string so new fields don't need a schema migration.
  try { db.exec(`ALTER TABLE messages ADD COLUMN metadata TEXT`); } catch {}
  // Which composer-mode selections the turn ran under. NULL for pre-
  // migration rows; populated by the runtime at turn finalize so the
  // analytics route can group aggregates (turn count, cost, tokens) by
  // plan vs. act and by reasoning-effort level.
  try { db.exec(`ALTER TABLE messages ADD COLUMN planMode TEXT`); } catch {}
  try { db.exec(`ALTER TABLE messages ADD COLUMN reasoningEffort TEXT`); } catch {}
  // Indexes for the common aggregate queries we'll want to run.
  try { db.exec(`CREATE INDEX IF NOT EXISTS messages_model_idx ON messages(model)`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS messages_cost_idx ON messages(costUsd)`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS messages_plan_mode_idx ON messages(planMode)`); } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS messages_effort_idx ON messages(reasoningEffort)`); } catch {}
};
