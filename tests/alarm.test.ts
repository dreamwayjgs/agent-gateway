process.env.TELEGRAM_BOT_TOKEN = "1:test-token";
process.env.DB_FILE = ":memory:";

import { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { fire, nextFireAt } from "../src/alarm";
import { getDb } from "../src/db";
import { extractAlarms } from "../src/template";
import type { RepeatUnit } from "../src/alarm";

beforeEach(() => {
  getDb().run("DELETE FROM alarms");
});

function epoch(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function insertAlarm(fields: {
  fireAt: number;
  unit?: RepeatUnit;
  interval?: number;
  count?: number | null;
  until?: number | null;
}): number {
  const result = getDb().run(
    `INSERT INTO alarms
      (chat_id, fire_at, content, platform, repeat_unit, repeat_interval, repeat_count, repeat_until)
     VALUES ('chat', ?, 'content', 'telegram', ?, ?, ?, ?)`,
    [fields.fireAt, fields.unit ?? null, fields.interval ?? null, fields.count ?? null, fields.until ?? null]
  );
  return Number(result.lastInsertRowid);
}

test("nextFireAt supports interval units", () => {
  const base = epoch("2026-07-06T00:00:00+09:00");

  expect(nextFireAt(base, "minute", 5, null, "Asia/Seoul")).toBe(base + 5 * 60);
  expect(nextFireAt(base, "hour", 2, null, "Asia/Seoul")).toBe(base + 2 * 3600);
  expect(nextFireAt(base, "day", 3, null, "Asia/Seoul")).toBe(base + 3 * 86400);
  expect(nextFireAt(base, "week", 2, null, "Asia/Seoul")).toBe(base + 14 * 86400);
});

test("nextFireAt clamps month and handles multi-year rollover", () => {
  expect(nextFireAt(epoch("2026-01-31T09:00:00+09:00"), "month", 1, 31, "Asia/Seoul"))
    .toBe(epoch("2026-02-28T09:00:00+09:00"));
  expect(nextFireAt(epoch("2026-01-31T09:00:00+09:00"), "month", 14, 31, "Asia/Seoul"))
    .toBe(epoch("2027-03-31T09:00:00+09:00"));
});

test("nextFireAt weekdays skips weekends", () => {
  expect(nextFireAt(epoch("2026-07-03T09:00:00+09:00"), "weekdays", 1, null, "Asia/Seoul"))
    .toBe(epoch("2026-07-06T09:00:00+09:00"));
});

test("fire marks sent when repeat count is exhausted", () => {
  const fireAt = epoch("2026-07-06T09:00:00+09:00");
  const id = insertAlarm({ fireAt, unit: "minute", interval: 5, count: 1 });

  fire(id, fireAt, "chat", "content", "telegram", { unit: "minute", interval: 5, count: 1 }, null);

  const row = getDb().query<{ sent: number; repeat_count: number }, [number]>("SELECT sent, repeat_count FROM alarms WHERE id = ?").get(id)!;
  expect(row.sent).toBe(1);
  expect(row.repeat_count).toBe(0);
});

test("fire marks sent when next occurrence exceeds until", () => {
  const fireAt = epoch("2026-07-06T09:00:00+09:00");
  const until = epoch("2026-07-06T09:04:00+09:00");
  const id = insertAlarm({ fireAt, unit: "minute", interval: 5, until });

  fire(id, fireAt, "chat", "content", "telegram", { unit: "minute", interval: 5, until }, null);

  const row = getDb().query<{ sent: number }, [number]>("SELECT sent FROM alarms WHERE id = ?").get(id)!;
  expect(row.sent).toBe(1);
});

test("fire reschedules endless repeat", () => {
  const fireAt = epoch("2026-07-06T09:00:00+09:00");
  const id = insertAlarm({ fireAt, unit: "week", interval: 2 });

  fire(id, fireAt, "chat", "content", "telegram", { unit: "week", interval: 2 }, null);

  const row = getDb().query<{ sent: number; fire_at: number }, [number]>("SELECT sent, fire_at FROM alarms WHERE id = ?").get(id)!;
  expect(row.sent).toBe(0);
  expect(row.fire_at).toBe(fireAt + 14 * 86400);
});

test("extractAlarms parses interval repeat specs and legacy names", () => {
  const iso = "2027-07-06T09:00:00+09:00";

  expect(extractAlarms(`{{알람:${iso}|격주|every=2w}}`, "chat", "telegram")).toContain("2주마다");
  expect(extractAlarms(`{{알람:${iso}|버스트|every=5m|count=7}}`, "chat", "telegram")).toContain("5분마다 7회");
  expect(extractAlarms(`{{알람:${iso}|종료|daily|until=2027-07-14T09:00:00+09:00}}`, "chat", "telegram")).toContain("매일");
  expect(extractAlarms(`{{알람:${iso}|기존|weekly}}`, "chat", "telegram")).toContain("매주");

  const rows = getDb()
    .query<{ repeat_unit: string; repeat_interval: number; repeat_count: number | null }, []>(
      "SELECT repeat_unit, repeat_interval, repeat_count FROM alarms ORDER BY id"
    )
    .all();
  expect(rows.map((r) => [r.repeat_unit, r.repeat_interval, r.repeat_count])).toEqual([
    ["week", 2, null],
    ["minute", 5, 7],
    ["day", 1, null],
    ["week", 1, null],
  ]);
});

test("extractAlarms rejects invalid repeat spec", () => {
  const result = extractAlarms("{{알람:2026-07-06T09:00:00+09:00|bad|every=0m}}", "chat", "telegram");

  expect(result).toContain("알람 등록 실패");
  expect(getDb().query<{ count: number }, []>("SELECT count(*) AS count FROM alarms").get()!.count).toBe(0);
});

test("migration 013 backfills legacy repeat into interval columns", () => {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE alarms (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, fire_at INTEGER NOT NULL, content TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0, repeat TEXT, repeat_dom INTEGER, platform TEXT NOT NULL DEFAULT 'telegram')`);
  db.run("INSERT INTO alarms (chat_id, fire_at, content, repeat) VALUES ('1', 1, 'daily', 'daily')");
  db.run("INSERT INTO alarms (chat_id, fire_at, content, repeat) VALUES ('1', 1, 'weekly', 'weekly')");
  db.run("INSERT INTO alarms (chat_id, fire_at, content, repeat) VALUES ('1', 1, 'monthly', 'monthly')");
  db.run("INSERT INTO alarms (chat_id, fire_at, content, repeat) VALUES ('1', 1, 'weekdays', 'weekdays')");
  db.run("INSERT INTO alarms (chat_id, fire_at, content, repeat) VALUES ('1', 1, 'once', NULL)");

  db.run(`
    ALTER TABLE alarms ADD COLUMN repeat_unit TEXT;
    ALTER TABLE alarms ADD COLUMN repeat_interval INTEGER;
    ALTER TABLE alarms ADD COLUMN repeat_count INTEGER;
    ALTER TABLE alarms ADD COLUMN repeat_until INTEGER;
    UPDATE alarms
      SET repeat_unit = CASE repeat
          WHEN 'daily' THEN 'day'
          WHEN 'weekly' THEN 'week'
          WHEN 'monthly' THEN 'month'
          WHEN 'weekdays' THEN 'weekdays'
          ELSE NULL
        END,
        repeat_interval = CASE repeat
          WHEN 'daily' THEN 1
          WHEN 'weekly' THEN 1
          WHEN 'monthly' THEN 1
          WHEN 'weekdays' THEN 1
          ELSE NULL
        END;
  `);

  const rows = db.query<{ repeat_unit: string | null; repeat_interval: number | null }, []>("SELECT repeat_unit, repeat_interval FROM alarms ORDER BY id").all();
  expect(rows).toEqual([
    { repeat_unit: "day", repeat_interval: 1 },
    { repeat_unit: "week", repeat_interval: 1 },
    { repeat_unit: "month", repeat_interval: 1 },
    { repeat_unit: "weekdays", repeat_interval: 1 },
    { repeat_unit: null, repeat_interval: null },
  ]);
  db.close();
});
