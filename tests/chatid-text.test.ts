// 환경 설정은 src import보다 먼저 — config/db가 import 시점에 읽음
process.env.TELEGRAM_BOT_TOKEN ??= "1:test-token";
process.env.DB_FILE = ":memory:";
process.env.AGENT_BACKEND = "codex";

import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { handleMessage } from "../src/index";
import { getDb } from "../src/db";
import { getChatSettings, updateChatSettings } from "../src/chat-settings";
import { safeChatSegment } from "../src/util";
import type { FileRef, IncomingMsg, Messenger, OutFile } from "../src/messenger/types";

class FakeMessenger implements Messenger {
  texts: { chatId: string; text: string }[] = [];
  onMessage(): void {}
  async sendText(chatId: string, text: string): Promise<void> {
    this.texts.push({ chatId, text });
  }
  async sendFile(_c: string, _f: OutFile): Promise<void> {}
  async sendTyping(_c: string): Promise<void> {}
  async downloadFile(_ref: FileRef): Promise<{ buffer: Buffer; mimeType?: string }> {
    return { buffer: Buffer.from("fake") };
  }
  async start(): Promise<void> {}
}

function textMsg(chatId: string, userId: string | null, text: string): IncomingMsg {
  return {
    chatId,
    userId,
    userName: "tester",
    text,
    caption: null,
    files: [],
    voice: null,
    isGroup: false,
    date: Math.floor(Date.now() / 1000),
    raw: { mock: true },
    platform: "telegram",
  };
}

// Discord 스노우플레이크: Number() 라운드트립이면 깨질 값.
// Number("1234567890123456789") === 1234567890123456800 → String 복원 시 원본과 불일치.
const SNOWFLAKE = "1234567890123456789";
const SNOWFLAKE_USER = "987654321098765432";

test("Discord 자릿수 스노우플레이크 chat_id/user_id가 DB 왕복에서 정확히 보존", async () => {
  // 사전조건: Number 경유 시 손실됨을 명시 — 이 테스트가 의미 있으려면 다른 값이어야 함
  expect(String(Number(SNOWFLAKE))).not.toBe(SNOWFLAKE);

  const fake = new FakeMessenger();
  await handleMessage(textMsg(SNOWFLAKE, SNOWFLAKE_USER, "안녕"), fake);

  const row = getDb()
    .query<{ chat_id: string; user_id: string | null }, [string]>(
      "SELECT chat_id, user_id FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1"
    )
    .get(SNOWFLAKE);

  expect(row).not.toBeNull();
  expect(row!.chat_id).toBe(SNOWFLAKE);
  expect(row!.user_id).toBe(SNOWFLAKE_USER);
  // 컬럼이 TEXT라 typeof string으로 반환되어야 함 (INTEGER면 number)
  expect(typeof row!.chat_id).toBe("string");
});

test("텔레그램 음수 chat_id 저장/조회 동등성", async () => {
  const fake = new FakeMessenger();
  const tgChat = "-5284713059";
  await handleMessage(textMsg(tgChat, "42", "점심"), fake);

  const row = getDb()
    .query<{ chat_id: string }, [string]>(
      "SELECT chat_id FROM messages WHERE chat_id = ? LIMIT 1"
    )
    .get(tgChat);

  expect(row?.chat_id).toBe(tgChat);
});

test("chat_settings 스노우플레이크 키 왕복", () => {
  updateChatSettings(SNOWFLAKE, { translation: { enabled: true, target: "ja" } });
  const s = getChatSettings(SNOWFLAKE);
  expect(s.translation?.enabled).toBe(true);
  expect(s.translation?.target).toBe("ja");
});

test("safeChatSegment: 정상 chatId 통과, path traversal 시도 거부", () => {
  // 정상: 텔레그램 음수, Discord 스노우플레이크, Slack 영숫자
  expect(safeChatSegment("-5284713059")).toBe("-5284713059");
  expect(safeChatSegment(SNOWFLAKE)).toBe(SNOWFLAKE);
  expect(safeChatSegment("C01ABC23")).toBe("C01ABC23");

  // 거부: 경로 탈출/구분자/빈값
  for (const bad of ["..", "../x", "a/b", "a\\b", "", ".", "foo.bar", "a b"]) {
    expect(() => safeChatSegment(bad)).toThrow();
  }
});

test("마이그레이션 009: INTEGER 컬럼 기존 정수 행이 CAST로 TEXT 보존", () => {
  // 009 이전 스키마(INTEGER chat_id)를 재현 → 정수 행 삽입 → rebuild → 문자열 조회
  const db = new Database(":memory:");
  db.run(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL, user_id INTEGER, first_name TEXT,
    text TEXT, date INTEGER NOT NULL, raw TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user'
  )`);
  db.run("INSERT INTO messages (chat_id, user_id, text, date, raw) VALUES (?, ?, ?, ?, ?)", [
    -5284713059, 42, "hi", 1000, "{}",
  ]);

  // 009의 messages rebuild 패턴
  db.run(`
    CREATE TABLE messages_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, user_id TEXT,
      first_name TEXT, text TEXT, date INTEGER NOT NULL, raw TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user'
    );
    INSERT INTO messages_new (id, chat_id, user_id, first_name, text, date, raw, role)
      SELECT id, CAST(chat_id AS TEXT), CAST(user_id AS TEXT), first_name, text, date, raw, role FROM messages;
    DROP TABLE messages;
    ALTER TABLE messages_new RENAME TO messages;
  `);

  const row = db
    .query<{ chat_id: string; user_id: string | null }, []>("SELECT chat_id, user_id FROM messages")
    .get();
  expect(row!.chat_id).toBe("-5284713059");
  expect(row!.user_id).toBe("42");
  expect(typeof row!.chat_id).toBe("string");
  db.close();
});
