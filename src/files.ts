import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { getDb } from "./db";
import { config } from "./config";
import type { Bot } from "grammy";

export type SavedFile = {
  id: number;
  fileName: string;
  localPath: string;
};

export async function downloadAndSaveFile(
  bot: Bot,
  telegramFileId: string,
  fileName: string,
  mimeType: string | undefined,
  chatId: number,
  uploadedBy: string | null,
  memo: string | null,
  uploadedAt: number
): Promise<SavedFile> {
  const tgFile = await bot.api.getFile(telegramFileId);
  if (!tgFile.file_path) throw new Error("file_path not available");

  const url = `https://api.telegram.org/file/bot${config.telegramToken}/${tgFile.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`파일 다운로드 실패: ${res.status}`);

  const dir = join(config.workspaceDir, "files", String(chatId));
  await mkdir(dir, { recursive: true });

  const safeName = fileName.replace(/[^\w가-힣._-]/g, "_");
  const localPath = join(dir, `${uploadedAt}_${safeName}`);
  await Bun.write(localPath, await res.arrayBuffer());

  const result = getDb().run(
    `INSERT INTO files (chat_id, telegram_file_id, file_name, mime_type, local_path, memo, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [chatId, telegramFileId, fileName, mimeType ?? null, localPath, memo, uploadedBy, uploadedAt]
  );

  return { id: Number(result.lastInsertRowid), fileName, localPath };
}

export type FileRef = { id: number; localPath: string; fileName: string };

// {{파일:id}} 추출 후 텍스트에서 제거, 파일 정보 반환
const FILE_REF_RE = /\{\{파일:(\d+)\}\}/g;

export function extractFileRefs(text: string): { cleaned: string; refs: FileRef[] } {
  const refs: FileRef[] = [];
  const cleaned = text.replace(FILE_REF_RE, (_, idStr) => {
    const row = getDb()
      .query<{ local_path: string; file_name: string | null }, [number]>(
        "SELECT local_path, file_name FROM files WHERE id = ?"
      )
      .get(Number(idStr));
    if (row) refs.push({ id: Number(idStr), localPath: row.local_path, fileName: row.file_name ?? `file_${idStr}` });
    return "";
  });
  return { cleaned: cleaned.trim(), refs };
}

// ## 으로 시작하면 직전 파일에 메모 저장
export function tryUpdateMemo(chatId: number, text: string): boolean {
  if (!text.startsWith("##")) return false;

  const memo = text.slice(2).trim();
  if (!memo) return false;

  const last = getDb()
    .query<{ id: number }, [number]>(
      "SELECT id FROM files WHERE chat_id = ? ORDER BY uploaded_at DESC LIMIT 1"
    )
    .get(chatId);
  if (!last) return false;

  getDb().run("UPDATE files SET memo = ? WHERE id = ?", [memo, last.id]);
  return true;
}
