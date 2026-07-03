#!/usr/bin/env bun
// 사용법: bun scripts/files-list.ts <chat_id>
import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const chatId = process.argv[2];
if (!chatId) {
  console.error("usage: bun scripts/files-list.ts <chat_id>");
  process.exit(1);
}

const dbPath = resolve(import.meta.dir, "../..", process.env.DB_FILE ?? "data/data.db");
const db = new Database(dbPath, { readonly: true });

const rows = db
  .query<
    { id: number; file_name: string | null; memo: string | null; uploaded_by: string | null; uploaded_at: number },
    [string]
  >(
    `SELECT id, file_name, memo, uploaded_by, uploaded_at
     FROM files WHERE chat_id = ?
     ORDER BY uploaded_at DESC LIMIT 50`
  )
  .all(chatId);

if (rows.length === 0) {
  console.log("저장된 파일이 없습니다.");
} else {
  for (const r of rows) {
    const tz = process.env.BOT_TIMEZONE ?? "Asia/Seoul";
    const date = new Date(r.uploaded_at * 1000).toLocaleDateString("sv-SE", { timeZone: tz });
    const esc = (s: string) => s.replace(/\t/g, " ").replace(/\r?\n/g, "\\n");
    const name = esc(r.file_name ?? "(이름 없음)");
    const memo = esc(r.memo ?? "(메모 없음)");
    const by = esc(r.uploaded_by ?? "unknown");
    console.log(`#${r.id}\t${name}\t${memo}\t${by}\t${date}`);
  }
}
