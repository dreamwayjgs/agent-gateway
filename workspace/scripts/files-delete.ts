#!/usr/bin/env bun
// 사용법: bun scripts/files-delete.ts <chat_id> <id>
import { Database } from "bun:sqlite";
import { rename, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";

const [chatId, fileId] = process.argv.slice(2);
if (!chatId || !fileId) {
  console.error("usage: bun scripts/files-delete.ts <chat_id> <id>");
  process.exit(1);
}

const dbPath = process.env.DB_FILE ?? "../data.db";
const db = new Database(dbPath);

const row = db
  .query<{ local_path: string; file_name: string | null }, [number, number]>(
    "SELECT local_path, file_name FROM files WHERE id = ? AND chat_id = ?"
  )
  .get(Number(fileId), Number(chatId));

if (!row) {
  console.error(`파일을 찾을 수 없습니다: #${fileId}`);
  process.exit(1);
}

const trashDir = join(row.local_path, "..", "..", "__trash");
await mkdir(trashDir, { recursive: true });
await rename(row.local_path, join(trashDir, basename(row.local_path)));

db.run("DELETE FROM files WHERE id = ?", [Number(fileId)]);

console.log(`#${fileId} (${row.file_name ?? "unknown"}) → __trash 이동 완료`);
