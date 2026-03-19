#!/usr/bin/env bun
// 사용법: bun scripts/files-search.ts <chat_id> <검색어>
import { Database } from "bun:sqlite";

const [chatId, ...queryParts] = process.argv.slice(2);
const query = queryParts.join(" ");

if (!chatId || !query) {
  console.error("usage: bun scripts/files-search.ts <chat_id> <검색어>");
  process.exit(1);
}

const dbPath = process.env.DB_FILE ?? "../data.db";
const db = new Database(dbPath, { readonly: true });

const like = `%${query}%`;
const rows = db
  .query<
    { id: number; file_name: string | null; memo: string | null; uploaded_by: string | null; uploaded_at: number },
    [number, string, string, string]
  >(
    `SELECT id, file_name, memo, uploaded_by, uploaded_at
     FROM files
     WHERE chat_id = ? AND (memo LIKE ? OR file_name LIKE ? OR uploaded_by LIKE ?)
     ORDER BY uploaded_at DESC`
  )
  .all(Number(chatId), like, like, like);

if (rows.length === 0) {
  console.log("일치하는 파일이 없습니다.");
} else {
  for (const r of rows) {
    const date = new Date(r.uploaded_at * 1000).toISOString().slice(0, 10);
    const name = r.file_name ?? "(이름 없음)";
    const memo = r.memo ?? "(메모 없음)";
    const by = r.uploaded_by ?? "unknown";
    console.log(`#${r.id}\t${name}\t${memo}\t${by}\t${date}`);
  }
}
