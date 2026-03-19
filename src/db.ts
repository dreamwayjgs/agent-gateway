import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id     INTEGER NOT NULL,
        user_id     INTEGER,
        first_name  TEXT,
        text        TEXT,
        date        INTEGER NOT NULL,
        raw         TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        key         TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
    `,
  },
  {
    name: "002_alarms",
    sql: `
      CREATE TABLE IF NOT EXISTS alarms (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id   INTEGER NOT NULL,
        fire_at   INTEGER NOT NULL,
        content   TEXT NOT NULL,
        sent      INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    name: "003_files",
    sql: `
      CREATE TABLE IF NOT EXISTS files (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id           INTEGER NOT NULL,
        telegram_file_id  TEXT NOT NULL,
        file_name         TEXT,
        mime_type         TEXT,
        local_path        TEXT NOT NULL,
        memo              TEXT,
        uploaded_by       TEXT,
        uploaded_at       INTEGER NOT NULL
      );
    `,
  },
];

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  const file = process.env.DB_FILE ?? "./data/data.db";
  mkdirSync(dirname(file), { recursive: true });
  _db = new Database(file);
  _db.run("PRAGMA journal_mode=WAL");
  runMigrations(_db);
  return _db;
}

function runMigrations(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    db.query<{ name: string }, []>("SELECT name FROM migrations").all().map((r) => r.name)
  );

  for (const { name, sql } of MIGRATIONS) {
    if (applied.has(name)) continue;
    db.run(sql);
    db.run("INSERT INTO migrations (name, applied_at) VALUES (?, ?)", [
      name,
      Math.floor(Date.now() / 1000),
    ]);
    console.log(`[migration] applied: ${name}`);
  }
}
