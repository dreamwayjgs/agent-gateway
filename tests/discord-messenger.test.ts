process.env.TELEGRAM_BOT_TOKEN ??= "1:test-token";

import { test, expect } from "bun:test";
import {
  DiscordMessenger,
  isDiscordAllowed,
  splitDiscordText,
  toIncoming,
} from "../src/messenger/discord";

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
      if (next < 0xdc00 || next > 0xdfff) return true;
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

test("isDiscordAllowed allows empty allowlist and blocks missing users", () => {
  expect(isDiscordAllowed("u1", new Set())).toBe(true);
  expect(isDiscordAllowed("u1", new Set(["u1"]))).toBe(true);
  expect(isDiscordAllowed("u2", new Set(["u1"]))).toBe(false);
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
  const messenger = new DiscordMessenger("token", []);
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

test("DiscordMessenger.onMessage ignores bot and non-allowlisted messages", async () => {
  const messenger = new DiscordMessenger("token", ["allowed"]);
  let listener: ((message: any) => Promise<void>) | null = null;
  (messenger as any).client = {
    on: (_event: string, fn: (message: any) => Promise<void>) => {
      listener = fn;
    },
  };
  const handled: string[] = [];

  messenger.onMessage(async (msg) => {
    handled.push(msg.userId ?? "");
  });

  await listener!(fakeMessage({ author: { id: "bot", username: "bot", bot: true } }));
  await listener!(fakeMessage({ author: { id: "blocked", username: "blocked" } }));
  await listener!(fakeMessage({ author: { id: "allowed", username: "allowed" } }));

  expect(handled).toEqual(["allowed"]);
});
