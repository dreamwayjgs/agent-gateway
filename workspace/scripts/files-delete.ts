#!/usr/bin/env bun
// 사용법: bun scripts/files-delete.ts <chat_id> <id>
import { Database } from "bun:sqlite";
import { rename, mkdir } from "node:fs/promises";
import { join, basename, resolve, isAbsolute } from "node:path";

const [chatId, fileId] = process.argv.slice(2);
if (!chatId || !fileId) {
  console.error("usage: bun scripts/files-delete.ts <chat_id> <id>");
  process.exit(1);
}

const dbPath = resolve(import.meta.dir, "../..", process.env.DB_FILE ?? "data/data.db");
const db = new Database(dbPath);

const row = db
  .query<{ local_path: string; file_name: string | null }, [number, string]>(
    "SELECT local_path, file_name FROM files WHERE id = ? AND chat_id = ?"
  )
  .get(Number(fileId), chatId);

if (!row) {
  console.error(`파일을 찾을 수 없습니다: #${fileId}`);
  process.exit(1);
}

// local_path는 workspace 기준 상대경로. import.meta.dir/.. = workspace 루트 (호스트/컨테이너 양쪽 유효).
// 주의: 앱(files.ts)은 config.workspaceDir(WORKSPACE_DIR ?? "./workspace", CWD 기준)로 해석하지만
// 이 독립 스크립트는 config import 없이 스크립트 부모를 workspace 루트로 가정한다.
// WORKSPACE_DIR을 스크립트 부모가 아닌 경로로 override한 배포에선 경로가 어긋날 수 있음.
const abs = isAbsolute(row.local_path) ? row.local_path : resolve(import.meta.dir, "..", row.local_path);
const trashDir = join(abs, "..", "..", "__trash");
await mkdir(trashDir, { recursive: true });
await rename(abs, join(trashDir, basename(abs)));

db.run("DELETE FROM files WHERE id = ?", [Number(fileId)]);

console.log(`#${fileId} (${row.file_name ?? "unknown"}) → __trash 이동 완료`);
