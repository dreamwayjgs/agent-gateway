#!/usr/bin/env bun
// 사용법: bun scripts/alarms-list.ts <chat_id>
import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const chatId = process.argv[2];
if (!chatId) {
  console.error("usage: bun scripts/alarms-list.ts <chat_id>");
  process.exit(1);
}

const dbPath = resolve(import.meta.dir, "../..", process.env.DB_FILE ?? "data/data.db");
const db = new Database(dbPath, { readonly: true });

const now = Math.floor(Date.now() / 1000);
const rows = db
  .query<
    { id: number; fire_at: number; content: string; repeat: string | null },
    [number, number]
  >(
    `SELECT id, fire_at, content, repeat
     FROM alarms
     WHERE chat_id = ? AND sent = 0 AND fire_at > ?
     ORDER BY fire_at ASC`
  )
  .all(Number(chatId), now);

if (rows.length === 0) {
  console.log("예정된 알람이 없습니다.");
} else {
  const tz = process.env.BOT_TIMEZONE ?? "Asia/Seoul";
  for (const r of rows) {
    const timeStr = new Date(r.fire_at * 1000).toLocaleString("ko-KR", {
      timeZone: tz,
      hour12: false,
    });
    const content = r.content.replace(/\t/g, " ").replace(/\r?\n/g, "\\n");
    const repeat = r.repeat ?? "-";
    console.log(`#${r.id}\t${timeStr}\t${repeat}\t${content}`);
  }
}
