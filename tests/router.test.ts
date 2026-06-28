// 환경 설정은 src import보다 먼저 — config/db가 import 시점에 읽음
process.env.TELEGRAM_BOT_TOKEN ??= "1:test-token";
process.env.DB_FILE = ":memory:";
process.env.AGENT_BACKEND = "codex";

import { test, expect } from "bun:test";
import { handleMessage } from "../src/index";
import { TelegramMessenger } from "../src/messenger/telegram";
import type { FileRef, IncomingMsg, Messenger, OutFile } from "../src/messenger/types";

class FakeMessenger implements Messenger {
  texts: { chatId: string; text: string }[] = [];
  files: { chatId: string; file: OutFile }[] = [];
  typing: string[] = [];

  onMessage(): void {}
  async sendText(chatId: string, text: string): Promise<void> {
    this.texts.push({ chatId, text });
  }
  async sendFile(chatId: string, file: OutFile): Promise<void> {
    this.files.push({ chatId, file });
  }
  async sendTyping(chatId: string): Promise<void> {
    this.typing.push(chatId);
  }
  async downloadFile(_ref: FileRef): Promise<{ buffer: Buffer; mimeType?: string }> {
    return { buffer: Buffer.from("fake-bytes") };
  }
  async start(): Promise<void> {}
}

function textMsg(text: string, over: Partial<IncomingMsg> = {}): IncomingMsg {
  return {
    chatId: "100",
    userId: "1",
    userName: "tester",
    text,
    caption: null,
    files: [],
    voice: null,
    isGroup: false,
    date: Math.floor(Date.now() / 1000),
    raw: { mock: true },
    platform: "telegram",
    ...over,
  };
}

test("도움말 트리거 → sendText로 도움말 1회 전송, 에이전트 미호출", async () => {
  const fake = new FakeMessenger();
  await handleMessage(textMsg("도움말"), fake);

  expect(fake.texts.length).toBe(1);
  expect(fake.texts[0]!.chatId).toBe("100");
  expect(fake.texts[0]!.text.length).toBeGreaterThan(0);
  // 에이전트 경로는 진입 시 sendTyping 호출 → 도움말 분기는 타이핑 없음
  expect(fake.typing.length).toBe(0);
});

test("트리거 없는 일반 텍스트 → 저장만, 전송/타이핑/에이전트 없음", async () => {
  const fake = new FakeMessenger();
  await handleMessage(textMsg("안녕하세요 점심 뭐 먹지"), fake);

  // 에이전트 경로 진입 시 sendTyping이 찍힘 → 0이면 에이전트 미호출 증명
  expect(fake.typing.length).toBe(0);
  expect(fake.texts.length).toBe(0);
  expect(fake.files.length).toBe(0);
});

test("TelegramMessenger.sendText는 4096 초과 텍스트를 분할 전송", async () => {
  const tm = new TelegramMessenger("1:test-token");
  const sent: string[] = [];
  // 실제 분할 로직 검증 — bot.api만 가짜로 대체
  (tm as any).bot = { api: { sendMessage: async (_id: string, t: string) => void sent.push(t) } };

  const big = "x".repeat(9000);
  await tm.sendText("100", big);

  expect(sent.length).toBe(3); // 4096 + 4096 + 808
  for (const chunk of sent) expect(chunk.length).toBeLessThanOrEqual(4096);
  expect(sent.join("")).toBe(big);
});
