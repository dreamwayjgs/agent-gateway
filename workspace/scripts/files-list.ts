#!/usr/bin/env bun
// 사용법: bun scripts/files-list.ts <chat_id>
import { Database } from "bun:sqlite";

const chatId = process.argv[2];
if (!chatId) {
  console.error("usage: bun scripts/files-list.ts <chat_id>");
  process.exit(1);
}

const dbPath = process.env.DB_FILE ?? "../data.db";
const db = new Database(dbPath, { readonly: true });

const rows = db
  .query<
    { id: number; file_name: string | null; memo: string | null; uploaded_by: string | null; uploaded_at: number },
    [number]
  >(
    `SELECT id, file_name, memo, uploaded_by, uploaded_at
     FROM files WHERE chat_id = ?
     ORDER BY uploaded_at DESC LIMIT 50`
  )
  .all(Number(chatId));

if (rows.length === 0) {
  console.log("저장된 파일이 없습니다.");
} else {
  for (const r of rows) {
    const date = new Date(r.uploaded_at * 1000).toISOString().slice(0, 10);
    const name = r.file_name ?? "(이름 없음)";
    const memo = r.memo ?? "(메모 없음)";
    const by = r.uploaded_by ?? "unknown";
    console.log(`#${r.id}\t${name}\t${memo}\t${by}\t${date}`);
  }
}
