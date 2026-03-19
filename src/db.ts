import { Database } from "bun:sqlite";

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  const file = process.env.DB_FILE ?? "./data.db";
  _db = new Database(file);
  _db.run("PRAGMA journal_mode=WAL");
  _db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id     INTEGER NOT NULL,
      user_id     INTEGER,
      first_name  TEXT,
      text        TEXT,
      date        INTEGER NOT NULL,
      raw         TEXT NOT NULL
    )
  `);
  _db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      key         TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    )
  `);
  return _db;
}
