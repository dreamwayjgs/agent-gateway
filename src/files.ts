import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { getDb } from "./db";
import { config } from "./config";
import { safeChatSegment } from "./util";
import type { FileDownloader } from "./messenger/types";

export type SavedFile = {
  id: number;
  fileName: string;
  localPath: string;
};

export async function downloadAndSaveFile(
  download: FileDownloader,
  telegramFileId: string,
  fileName: string,
  mimeType: string | undefined,
  chatId: string,
  uploadedBy: string | null,
  memo: string | null,
  uploadedAt: number
): Promise<SavedFile> {
  const { buffer } = await download({ id: telegramFileId, fileName, mimeType });

  const dir = join(config.workspaceDir, "files", safeChatSegment(chatId));
  await mkdir(dir, { recursive: true });

  const safeName = fileName.replace(/[^\w가-힣._-]/g, "_");
  const localPath = join(dir, `${uploadedAt}_${safeName}`);
  await Bun.write(localPath, buffer);

  const result = getDb().run(
    `INSERT INTO files (chat_id, telegram_file_id, file_name, mime_type, local_path, memo, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [chatId, telegramFileId, fileName, mimeType ?? null, localPath, memo, uploadedBy, uploadedAt]
  );

  return { id: Number(result.lastInsertRowid), fileName, localPath };
}

export type FileRef = { id: number; localPath: string; fileName: string; mimeType: string | null };

// {{파일:id}} 추출 후 텍스트에서 제거, 파일 정보 반환
const FILE_REF_RE = /\{\{파일:(\d+)\}\}/g;

export function extractFileRefs(text: string, chatId: string): { cleaned: string; refs: FileRef[] } {
  const refs: FileRef[] = [];
  const cleaned = text.replace(FILE_REF_RE, (_, idStr) => {
    const row = getDb()
      .query<{ local_path: string; file_name: string | null; mime_type: string | null }, [number, string]>(
        "SELECT local_path, file_name, mime_type FROM files WHERE id = ? AND chat_id = ?"
      )
      .get(Number(idStr), chatId);
    if (row) refs.push({ id: Number(idStr), localPath: row.local_path, fileName: row.file_name ?? `file_${idStr}`, mimeType: row.mime_type });
    return "";
  });
  return { cleaned: cleaned.trim(), refs };
}

// ## 으로 시작하면 직전 파일에 메모 저장
export function tryUpdateMemo(chatId: string, text: string): boolean {
  if (!text.startsWith("##")) return false;

  const memo = text.slice(2).trim();
  if (!memo) return false;

  const last = getDb()
    .query<{ id: number }, [string]>(
      "SELECT id FROM files WHERE chat_id = ? ORDER BY uploaded_at DESC LIMIT 1"
    )
    .get(chatId);
  if (!last) return false;

  getDb().run("UPDATE files SET memo = ? WHERE id = ?", [memo, last.id]);
  return true;
}
