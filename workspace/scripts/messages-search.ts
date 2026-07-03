#!/usr/bin/env bun
// 사용법: bun scripts/messages-search.ts <chat_id> <검색어> [최대건수]
import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const [chatId, ...rest] = process.argv.slice(2);
const last = rest.length > 1 && /^\d+$/.test(rest[rest.length - 1]!) ? rest.pop() : undefined;
const limit = last ? Number(last) : 30;
const query = rest.join(" ");

if (!chatId || !query) {
  console.error("usage: bun scripts/messages-search.ts <chat_id> <검색어> [최대건수]");
  process.exit(1);
}

const dbPath = resolve(import.meta.dir, "../..", process.env.DB_FILE ?? "data/data.db");
const db = new Database(dbPath, { readonly: true });

const like = `%${query}%`;
const rows = db
  .query<
    { id: number; first_name: string | null; text: string | null; date: number; role: string },
    [string, string, number]
  >(
    `SELECT id, first_name, text, date, role
     FROM messages
     WHERE chat_id = ? AND text LIKE ?
     ORDER BY date DESC LIMIT ?`
  )
  .all(chatId, like, limit);

if (rows.length === 0) {
  console.log("일치하는 메시지가 없습니다.");
} else {
  const tz = process.env.BOT_TIMEZONE ?? "Asia/Seoul";
  const esc = (s: string) => s.replace(/\t/g, " ").replace(/\r?\n/g, "\\n");
  for (const r of rows.reverse()) {
    const when = new Date(r.date * 1000).toLocaleString("sv-SE", { timeZone: tz });
    const who = r.role === "assistant" ? "비서" : (r.first_name ?? "unknown");
    let text = esc(r.text ?? "");
    if (text.length > 300) text = text.slice(0, 300) + "…";
    console.log(`#${r.id}\t[${r.role}]\t${who}\t${when}\t${text}`);
  }
}
