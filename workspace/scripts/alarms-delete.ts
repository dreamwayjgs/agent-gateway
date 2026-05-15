#!/usr/bin/env bun
// 사용법: bun scripts/alarms-delete.ts <chat_id> <id>
import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const [chatId, alarmId] = process.argv.slice(2);
if (!chatId || !alarmId) {
  console.error("usage: bun scripts/alarms-delete.ts <chat_id> <id>");
  process.exit(1);
}

const dbPath = resolve(import.meta.dir, "../..", process.env.DB_FILE ?? "data/data.db");
const db = new Database(dbPath);

const row = db
  .query<{ id: number; content: string }, [number, number]>(
    "SELECT id, content FROM alarms WHERE id = ? AND chat_id = ?"
  )
  .get(Number(alarmId), Number(chatId));

if (!row) {
  console.error(`알람을 찾을 수 없습니다: #${alarmId}`);
  process.exit(1);
}

db.run("DELETE FROM alarms WHERE id = ?", [Number(alarmId)]);
console.log(`알람 #${alarmId} 삭제됨 — ${row.content}`);
