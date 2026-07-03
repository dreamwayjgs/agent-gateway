process.env.TELEGRAM_BOT_TOKEN = "1:test-token";
process.env.DISCORD_BOT_TOKEN = "discord-token";
process.env.DISCORD_ADMIN_USER_ID = "999999999999999999";
process.env.DB_FILE = ":memory:";

import { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { registerAlarm, initAlarms } from "../src/alarm";
import { config } from "../src/config";
import { getDb } from "../src/db";
import { sessionKeyFor } from "../src/index";
import { createMessengers } from "../src/messenger";
import type { FileRef, IncomingMsg, Messenger, OutFile, Platform } from "../src/messenger/types";
import { extractAlarms } from "../src/template";

class FakeMessenger implements Messenger {
  texts: { chatId: string; text: string }[] = [];
  constructor(readonly platform: Platform) {}
  onMessage(_handler: (msg: IncomingMsg) => Promise<void>): void {}
  async sendText(chatId: string, text: string): Promise<void> {
    this.texts.push({ chatId, text });
  }
  async sendFile(_chatId: string, _file: OutFile): Promise<void> {}
  async sendTyping(_chatId: string): Promise<void> {}
  async downloadFile(_ref: FileRef): Promise<{ buffer: Buffer; mimeType?: string }> {
    return { buffer: Buffer.from("fake") };
  }
  async start(): Promise<void> {}
}

beforeEach(() => {
  getDb().run("DELETE FROM alarms");
  getDb().run("DELETE FROM sessions");
});

test("createMessengers creates deduped platform list", () => {
  config.discordToken = "discord-token";
  config.discordAdminUserId = "999999999999999999";
  const messengers = createMessengers(["telegram", "discord", "telegram"]);
  expect(messengers.map((m) => m.platform)).toEqual(["telegram", "discord"]);
  expect(() => createMessengers([])).toThrow("MESSENGER must include at least one platform");
});

test("sessionKeyFor scopes chat ids by platform", () => {
  expect(sessionKeyFor({ platform: "telegram", chatId: "same" })).toBe("chat:telegram:same");
  expect(sessionKeyFor({ platform: "discord", chatId: "same" })).toBe("chat:discord:same");
});

test("registerAlarm routes fire to matching platform messenger", async () => {
  const telegram = new FakeMessenger("telegram");
  const discord = new FakeMessenger("discord");
  initAlarms(new Map([[telegram.platform, telegram], [discord.platform, discord]]));

  registerAlarm("tg-chat", Math.floor(Date.now() / 1000) - 1, "텔레그램", "telegram");
  registerAlarm("dc-chat", Math.floor(Date.now() / 1000) - 1, "디스코드", "discord");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(telegram.texts).toEqual([{ chatId: "tg-chat", text: "⏰ 텔레그램" }]);
  expect(discord.texts).toEqual([{ chatId: "dc-chat", text: "⏰ 디스코드" }]);
});

test("alarm with non-running platform skips without throwing", async () => {
  const telegram = new FakeMessenger("telegram");
  const warns: string[] = [];
  const oldWarn = console.warn;
  console.warn = (msg?: unknown) => void warns.push(String(msg));
  try {
    initAlarms(new Map([[telegram.platform, telegram]]));
    registerAlarm("dc-chat", Math.floor(Date.now() / 1000) - 1, "디스코드", "discord");
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    console.warn = oldWarn;
  }

  expect(telegram.texts).toEqual([]);
  expect(warns.some((w) => w.includes("platform=discord"))).toBe(true);
});

test("extractAlarms stores platform and filters list/cancel by platform", () => {
  const iso = new Date(Date.now() + 60_000).toISOString();
  const registered = extractAlarms(`{{알람:${iso}|테스트}}`, "same-chat", "discord");
  expect(registered).toContain("알람 등록됨");

  const row = getDb()
    .query<{ id: number; platform: string }, []>("SELECT id, platform FROM alarms ORDER BY id DESC LIMIT 1")
    .get();
  expect(row!.platform).toBe("discord");
  expect(extractAlarms("{{알람목록}}", "same-chat", "telegram")).toBe("예정된 알람이 없습니다.");
  expect(extractAlarms("{{알람목록}}", "same-chat", "discord")).toContain("테스트");
  expect(extractAlarms(`{{알람취소:${row!.id}}}`, "same-chat", "telegram")).toContain("없음");
  expect(extractAlarms(`{{알람취소:${row!.id}}}`, "same-chat", "discord")).toBe(`알람 #${row!.id} 취소됨`);
});

test("migration 011 backfills session keys and defaults alarms platform", () => {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE sessions (key TEXT PRIMARY KEY, session_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  db.run(`CREATE TABLE alarms (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, fire_at INTEGER NOT NULL, content TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0, repeat TEXT, repeat_dom INTEGER)`);
  db.run("INSERT INTO sessions (key, session_id, created_at, updated_at) VALUES (?, ?, 1, 1)", ["chat:123", "s1"]);
  db.run("INSERT INTO sessions (key, session_id, created_at, updated_at) VALUES (?, ?, 1, 1)", ["chat:discord:456", "s2"]);
  db.run("INSERT INTO alarms (chat_id, fire_at, content) VALUES ('123', 1000, 'hi')");

  db.run(`
    ALTER TABLE alarms ADD COLUMN platform TEXT NOT NULL DEFAULT 'telegram';
    UPDATE sessions
      SET key = 'chat:telegram:' || substr(key, 6)
      WHERE key LIKE 'chat:%' AND key NOT LIKE 'chat:%:%';
  `);

  const sessions = db.query<{ key: string }, []>("SELECT key FROM sessions ORDER BY key").all().map((r) => r.key);
  expect(sessions).toEqual(["chat:discord:456", "chat:telegram:123"]);
  expect(db.query<{ platform: string }, []>("SELECT platform FROM alarms").get()!.platform).toBe("telegram");
  db.close();
});
