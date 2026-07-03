// 환경 설정은 src import보다 먼저 — config/db가 import 시점에 읽음
process.env.TELEGRAM_BOT_TOKEN ??= "1:test-token";
process.env.DB_FILE = ":memory:";
process.env.AGENT_BACKEND = "codex";

import { test, expect } from "bun:test";
import { join } from "node:path";
import { extractFileRefs, resolveWorkspacePath } from "../src/files";
import { getDb } from "../src/db";
import { config } from "../src/config";

function insertFile(chatId: string, localPath: string): number {
  const r = getDb().run(
    `INSERT INTO files (chat_id, telegram_file_id, file_name, mime_type, local_path, memo, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [chatId, "tf", "photo.jpg", "image/jpeg", localPath, null, null, 1774502451]
  );
  return Number(r.lastInsertRowid);
}

test("resolveWorkspacePath: 상대→workspace 절대, 절대는 통과", () => {
  expect(resolveWorkspacePath("files/42/x.jpg")).toBe(join(config.workspaceDir, "files/42/x.jpg"));
  expect(resolveWorkspacePath("/abs/x.jpg")).toBe("/abs/x.jpg");
});

test("extractFileRefs: DB 상대경로를 절대경로로 해석해 반환", () => {
  const chatId = "12345";
  const id = insertFile(chatId, "files/12345/1774502451_photo.jpg");

  const { cleaned, refs } = extractFileRefs(`사진 {{파일:${id}}} 보여줘`, chatId);

  expect(cleaned).toBe("사진  보여줘");
  expect(refs).toHaveLength(1);
  expect(refs[0]!.localPath).toBe(join(config.workspaceDir, "files/12345/1774502451_photo.jpg"));
});

test("extractFileRefs: 마이그레이션 누락 절대경로 행은 그대로 통과", () => {
  const chatId = "67890";
  const id = insertFile(chatId, "/home/bun/workspace/files/67890/old.jpg");

  const { refs } = extractFileRefs(`{{파일:${id}}}`, chatId);
  expect(refs[0]!.localPath).toBe("/home/bun/workspace/files/67890/old.jpg");
});
