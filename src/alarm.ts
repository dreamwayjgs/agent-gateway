import { getDb } from "./db";
import type { Bot } from "grammy";

let _bot: Bot | null = null;

export function registerAlarm(chatId: number, fireAt: number, content: string): void {
  const result = getDb().run(
    "INSERT INTO alarms (chat_id, fire_at, content) VALUES (?, ?, ?)",
    [chatId, fireAt, content]
  );
  scheduleAlarm(Number(result.lastInsertRowid), fireAt, chatId, content);
}

export function initAlarms(bot: Bot): void {
  _bot = bot;

  // 재시작 후 미발송 알람 복구
  const pending = getDb()
    .query<{ id: number; chat_id: number; fire_at: number; content: string }, []>(
      "SELECT id, chat_id, fire_at, content FROM alarms WHERE sent = 0"
    )
    .all();

  for (const alarm of pending) {
    scheduleAlarm(alarm.id, alarm.fire_at, alarm.chat_id, alarm.content);
  }
  if (pending.length > 0) console.log(`[alarm] ${pending.length}개 알람 복구됨`);

  // safety-net: setTimeout이 누락됐을 경우를 위한 폴링 (5분)
  setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    const missed = getDb()
      .query<{ id: number; chat_id: number; content: string }, [number]>(
        "SELECT id, chat_id, content FROM alarms WHERE fire_at <= ? AND sent = 0"
      )
      .all(now);

    for (const alarm of missed) {
      console.warn(`[alarm] safety-net 발송: id=${alarm.id}`);
      fire(alarm.id, alarm.chat_id, alarm.content);
    }
  }, 5 * 60_000);
}

const MAX_TIMEOUT_MS = 2 ** 31 - 1; // ~24.8일, setTimeout 32비트 한계

function scheduleAlarm(id: number, fireAt: number, chatId: number, content: string): void {
  const delay = fireAt * 1000 - Date.now();
  if (delay <= 0) {
    fire(id, chatId, content);
  } else if (delay <= MAX_TIMEOUT_MS) {
    setTimeout(() => fire(id, chatId, content), delay);
  }
  // 초과 시 safety-net 폴링(5분)에 위임
}

function fire(id: number, chatId: number, content: string): void {
  getDb().run("UPDATE alarms SET sent = 1 WHERE id = ?", [id]);
  _bot?.api
    .sendMessage(chatId, `⏰ ${content}`)
    .catch((err) => console.error("알람 발송 실패:", err));
}
