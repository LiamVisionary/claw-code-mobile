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
  `);

  // Additive migrations — safe to re-run (errors ignored if column already exists)
  try { db.exec(`ALTER TABLE threads ADD COLUMN workDir TEXT NOT NULL DEFAULT ''`); } catch {}
};
