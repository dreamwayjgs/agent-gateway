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
  {
    name: "004_sessions_backend",
    sql: `
      DELETE FROM sessions;
      ALTER TABLE sessions ADD COLUMN backend TEXT NOT NULL DEFAULT 'codex';
    `,
  },
  {
    name: "005_chat_settings",
    sql: `
      CREATE TABLE IF NOT EXISTS chat_settings (
        chat_id    INTEGER PRIMARY KEY,
        settings   TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    name: "006_voice_logs",
    sql: `
      CREATE TABLE IF NOT EXISTS voice_logs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id     INTEGER NOT NULL,
        file_id     TEXT NOT NULL,
        local_path  TEXT NOT NULL,
        transcript  TEXT NOT NULL,
        translation TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        created_at  INTEGER NOT NULL
      );
    `,
  },
  {
    name: "007_alarm_repeat",
    sql: `
      ALTER TABLE alarms ADD COLUMN repeat TEXT;
      ALTER TABLE alarms ADD COLUMN repeat_dom INTEGER;
    `,
  },
  {
    name: "008_messages_role",
    sql: `
      ALTER TABLE messages ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
    `,
  },
  {
    // chat_id/user_id를 TEXT로 전환 (Discord 64bit 스노우플레이크 무손실 저장/읽기).
    // SQLite는 ALTER COLUMN TYPE이 없어 테이블 재생성(rebuild). 기존 정수 행은 CAST(... AS TEXT)로 보존.
    name: "009_chatid_text",
    sql: `
      CREATE TABLE messages_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id     TEXT NOT NULL,
        user_id     TEXT,
        first_name  TEXT,
        text        TEXT,
        date        INTEGER NOT NULL,
        raw         TEXT NOT NULL,
        role        TEXT NOT NULL DEFAULT 'user'
      );
      INSERT INTO messages_new (id, chat_id, user_id, first_name, text, date, raw, role)
        SELECT id, CAST(chat_id AS TEXT), CAST(user_id AS TEXT), first_name, text, date, raw, role FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;

      CREATE TABLE alarms_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id     TEXT NOT NULL,
        fire_at     INTEGER NOT NULL,
        content     TEXT NOT NULL,
        sent        INTEGER NOT NULL DEFAULT 0,
        repeat      TEXT,
        repeat_dom  INTEGER
      );
      INSERT INTO alarms_new (id, chat_id, fire_at, content, sent, repeat, repeat_dom)
        SELECT id, CAST(chat_id AS TEXT), fire_at, content, sent, repeat, repeat_dom FROM alarms;
      DROP TABLE alarms;
      ALTER TABLE alarms_new RENAME TO alarms;

      CREATE TABLE files_new (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id           TEXT NOT NULL,
        telegram_file_id  TEXT NOT NULL,
        file_name         TEXT,
        mime_type         TEXT,
        local_path        TEXT NOT NULL,
        memo              TEXT,
        uploaded_by       TEXT,
        uploaded_at       INTEGER NOT NULL
      );
      INSERT INTO files_new (id, chat_id, telegram_file_id, file_name, mime_type, local_path, memo, uploaded_by, uploaded_at)
        SELECT id, CAST(chat_id AS TEXT), telegram_file_id, file_name, mime_type, local_path, memo, uploaded_by, uploaded_at FROM files;
      DROP TABLE files;
      ALTER TABLE files_new RENAME TO files;

      CREATE TABLE chat_settings_new (
        chat_id    TEXT PRIMARY KEY NOT NULL,
        settings   TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO chat_settings_new (chat_id, settings, updated_at)
        SELECT CAST(chat_id AS TEXT), settings, updated_at FROM chat_settings;
      DROP TABLE chat_settings;
      ALTER TABLE chat_settings_new RENAME TO chat_settings;

      CREATE TABLE voice_logs_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id     TEXT NOT NULL,
        file_id     TEXT NOT NULL,
        local_path  TEXT NOT NULL,
        transcript  TEXT NOT NULL,
        translation TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        created_at  INTEGER NOT NULL
      );
      INSERT INTO voice_logs_new (id, chat_id, file_id, local_path, transcript, translation, target_lang, created_at)
        SELECT id, CAST(chat_id AS TEXT), file_id, local_path, transcript, translation, target_lang, created_at FROM voice_logs;
      DROP TABLE voice_logs;
      ALTER TABLE voice_logs_new RENAME TO voice_logs;
    `,
  },
  {
    name: "010_discord_allowlist",
    sql: `
      CREATE TABLE IF NOT EXISTS discord_allowlist (
        user_id   TEXT PRIMARY KEY NOT NULL,
        name      TEXT,
        added_at  INTEGER NOT NULL
      );
    `,
  },
  {
    name: "011_multimessenger_scope",
    sql: `
      ALTER TABLE alarms ADD COLUMN platform TEXT NOT NULL DEFAULT 'telegram';
      UPDATE sessions
        SET key = 'chat:telegram:' || substr(key, 6)
        WHERE key LIKE 'chat:%' AND key NOT LIKE 'chat:%:%';
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
    // 트랜잭션 래핑: 009처럼 다중 DROP/RENAME을 하는 마이그레이션이 중간 실패해도
    // 부분 상태가 남지 않도록 원자적으로 적용 (실패 시 전체 롤백).
    db.transaction(() => {
      db.run(sql);
      db.run("INSERT INTO migrations (name, applied_at) VALUES (?, ?)", [
        name,
        Math.floor(Date.now() / 1000),
      ]);
    })();
    console.log(`[migration] applied: ${name}`);
  }
}
