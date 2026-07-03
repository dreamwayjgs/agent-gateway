process.env.TELEGRAM_BOT_TOKEN ??= "1:test-token";
process.env.DB_FILE = ":memory:";

import { beforeEach, test, expect } from "bun:test";
import { getDb } from "../src/db";
import { addAllow, isFamilyAllowed, listAllow } from "../src/messenger/discord-allowlist";
import {
  DiscordMessenger,
  splitDiscordText,
  toIncoming,
} from "../src/messenger/discord";

beforeEach(() => {
  getDb().run("DELETE FROM discord_allowlist");
});

function fakeMessage(over: any = {}) {
  return {
    id: "m1",
    channelId: "1234567890123456789",
    author: {
      id: "987654321098765432",
      username: "tester",
      globalName: "Tester Global",
    },
    content: "hello",
    attachments: [],
    guild: null,
    createdTimestamp: 1_700_000_000_123,
    ...over,
  };
}

function hasUnpairedSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
      i++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

test("toIncoming maps Discord DM text without numeric conversion", () => {
  const msg = toIncoming(fakeMessage());

  expect(msg.chatId).toBe("1234567890123456789");
  expect(msg.userId).toBe("987654321098765432");
  expect(msg.userName).toBe("Tester Global");
  expect(msg.text).toBe("hello");
  expect(msg.caption).toBeNull();
  expect(msg.files).toEqual([]);
  expect(msg.voice).toBeNull();
  expect(msg.isGroup).toBe(false);
  expect(msg.date).toBe(1_700_000_000);
  expect(msg.platform).toBe("discord");
});

test("toIncoming maps Discord attachments as files with content as caption", () => {
  const msg = toIncoming(fakeMessage({
    content: "caption text",
    guild: { id: "guild1" },
    attachments: [
      {
        id: "a1",
        url: "https://cdn.discordapp.com/file.png",
        name: "file.png",
        contentType: "image/png",
        size: 123,
      },
    ],
  }));

  expect(msg.text).toBeNull();
  expect(msg.caption).toBe("caption text");
  expect(msg.isGroup).toBe(true);
  expect(msg.files).toEqual([
    { id: "https://cdn.discordapp.com/file.png", fileName: "file.png", mimeType: "image/png" },
  ]);
  expect(JSON.stringify(msg.raw)).toContain("file.png");
});

test("Discord DB allowlist allows admin and registered users only", () => {
  expect(isFamilyAllowed("999999999999999999", "999999999999999999")).toBe(true);
  expect(isFamilyAllowed("111111111111111111", "999999999999999999")).toBe(false);
  addAllow("111111111111111111", "가족");
  expect(isFamilyAllowed("111111111111111111", "999999999999999999")).toBe(true);
});

test("Discord text chunks stay within 2000 chars", () => {
  const big = "x".repeat(4500);
  const chunks = splitDiscordText(big);

  expect(chunks.length).toBe(3);
  for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(2000);
  expect(chunks.join("")).toBe(big);
});

test("Discord text chunks do not split astral emoji surrogate pairs", () => {
  const text = "x" + "😀".repeat(1500);
  const chunks = splitDiscordText(text);

  expect(chunks.join("")).toBe(text);
  for (const chunk of chunks) {
    expect(chunk.length).toBeLessThanOrEqual(2000);
    expect(hasUnpairedSurrogate(chunk)).toBe(false);
  }
});

test("DiscordMessenger.sendFile sends notice for any oversize file", async () => {
  const messenger = new DiscordMessenger("token", "999999999999999999");
  const texts: { chatId: string; text: string }[] = [];
  (messenger as any).client = {
    channels: {
      fetch: async () => ({
        send: async (text: string) => texts.push({ chatId: "c1", text }),
      }),
    },
  };

  await messenger.sendFile("c1", {
    data: Buffer.alloc(10 * 1024 * 1024 + 1),
    fileName: "big.jpg",
    kind: "photo",
  });

  expect(texts).toEqual([{ chatId: "c1", text: "파일이 커서 전송 못 함: big.jpg" }]);
});

test("DiscordMessenger.onMessage ignores bot, handles admin commands, notifies unknown once, and dispatches registered users", async () => {
  const messenger = new DiscordMessenger("token", "999999999999999999");
  let listener: ((message: any) => Promise<void>) | null = null;
  const sent: string[] = [];
  const adminDms: string[] = [];
  (messenger as any).client = {
    on: (_event: string, fn: (message: any) => Promise<void>) => {
      listener = fn;
    },
    channels: {
      fetch: async () => ({
        send: async (text: string) => sent.push(text),
      }),
    },
    users: {
      fetch: async (_id: string) => ({
        send: async (text: string) => adminDms.push(text),
      }),
    },
  };
  const handled: string[] = [];

  messenger.onMessage(async (msg) => {
    handled.push(msg.userId ?? "");
  });

  await listener!(fakeMessage({ author: { id: "bot", username: "bot", bot: true } }));
  await listener!(fakeMessage({ author: { id: "999999999999999999", username: "owner" }, content: "!허용 111111111111111111 가족" }));
  await listener!(fakeMessage({ author: { id: "222222222222222222", username: "blocked" }, guild: { name: "family" } }));
  await listener!(fakeMessage({ author: { id: "222222222222222222", username: "blocked" }, guild: { name: "family" } }));
  await listener!(fakeMessage({ author: { id: "111111111111111111", username: "allowed" } }));

  expect(handled).toEqual(["111111111111111111"]);
  expect(sent).toEqual(["허용 완료: 111111111111111111 (가족)"]);
  expect(listAllow().map((row) => ({ user_id: row.user_id, name: row.name }))).toEqual([
    { user_id: "111111111111111111", name: "가족" },
  ]);
  expect(adminDms.length).toBe(1);
  expect(adminDms[0]).toContain("blocked");
  expect(adminDms[0]).toContain("family");
});

test("DiscordMessenger admin block and list commands do not reach handler", async () => {
  addAllow("111111111111111111", "가족");
  const messenger = new DiscordMessenger("token", "999999999999999999");
  let listener: ((message: any) => Promise<void>) | null = null;
  const sent: string[] = [];
  (messenger as any).client = {
    on: (_event: string, fn: (message: any) => Promise<void>) => {
      listener = fn;
    },
    channels: {
      fetch: async () => ({
        send: async (text: string) => sent.push(text),
      }),
    },
  };
  const handled: string[] = [];
  messenger.onMessage(async (msg) => {
    handled.push(msg.userId ?? "");
  });

  await listener!(fakeMessage({ author: { id: "999999999999999999", username: "owner" }, content: "!목록" }));
  await listener!(fakeMessage({ author: { id: "999999999999999999", username: "owner" }, content: "!차단 111111111111111111" }));

  expect(handled).toEqual([]);
  expect(sent[0]).toContain("111111111111111111 (가족)");
  expect(sent[1]).toBe("차단 완료: 111111111111111111");
  expect(listAllow()).toEqual([]);
});

test("DiscordMessenger admin commands are DM-only and invalid command shapes show usage", async () => {
  const messenger = new DiscordMessenger("token", "999999999999999999");
  let listener: ((message: any) => Promise<void>) | null = null;
  const sent: string[] = [];
  const handled: string[] = [];
  (messenger as any).client = {
    on: (_event: string, fn: (message: any) => Promise<void>) => {
      listener = fn;
    },
    channels: {
      fetch: async () => ({
        send: async (text: string) => sent.push(text),
      }),
    },
  };
  messenger.onMessage(async (msg) => {
    handled.push(msg.text ?? "");
  });

  await listener!(fakeMessage({ author: { id: "999999999999999999", username: "owner" }, content: "!목록", guild: { name: "family" } }));
  await listener!(fakeMessage({ author: { id: "999999999999999999", username: "owner" }, content: "!허용" }));
  await listener!(fakeMessage({ author: { id: "999999999999999999", username: "owner" }, content: "!차단 123 엄마" }));

  expect(handled).toEqual([]);
  expect(sent[0]).toBe("관리자 명령은 나와의 DM에서만 사용할 수 있어요.");
  expect(sent[1]).toContain("사용법:");
  expect(sent[2]).toContain("사용법:");
});

test("DiscordMessenger retries unknown-user notification after send failure", async () => {
  const messenger = new DiscordMessenger("token", "999999999999999999");
  let listener: ((message: any) => Promise<void>) | null = null;
  let attempts = 0;
  const adminDms: string[] = [];
  (messenger as any).client = {
    on: (_event: string, fn: (message: any) => Promise<void>) => {
      listener = fn;
    },
    users: {
      fetch: async (_id: string) => ({
        send: async (text: string) => {
          attempts++;
          if (attempts === 1) throw new Error("transient");
          adminDms.push(text);
        },
      }),
    },
  };
  messenger.onMessage(async () => {});

  await listener!(fakeMessage({ author: { id: "222222222222222222", username: "blocked" } }));
  await listener!(fakeMessage({ author: { id: "222222222222222222", username: "blocked" } }));

  expect(attempts).toBe(2);
  expect(adminDms.length).toBe(1);
});
