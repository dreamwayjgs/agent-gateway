import { Bot } from "grammy";
import { config } from "./config";
import { runCodex } from "./agent/codex";
import { getSession, setSession, deleteSession } from "./agent/session";

const bot = new Bot(config.telegramToken);

bot.on("message:text", async (ctx) => {
  const chatId = ctx.message.chat.id;
  const text = ctx.message.text;
  const name = ctx.message.from.first_name;
  const preview = text.slice(0, 160);
  console.log(`[${name}] ${preview}`);

  const sessionKey = `chat:${chatId}`;

  if (text.trim() === "세션 재시작") {
    deleteSession(config.sessionsFile, sessionKey);
    return ctx.reply("세션을 초기화했습니다.");
  }

  const resumeId = getSession(config.sessionsFile, sessionKey) ?? undefined;

  let result;
  try {
    result = await runCodex(text, resumeId);
  } catch (err) {
    console.error(err);
    return ctx.reply("에이전트 실행 중 오류가 발생했습니다.");
  }

  if (result.threadId && result.threadId !== resumeId) {
    setSession(config.sessionsFile, sessionKey, result.threadId);
  }

  // Telegram 메시지 최대 4096자 분할 전송
  const chunks = result.response.match(/[\s\S]{1,4096}/g) ?? [];
  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
});

bot.start();
console.log("Bot started (long polling)");
