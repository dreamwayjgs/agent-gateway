import { Bot } from "grammy";
import { getDb } from "./db";
import { config } from "./config";
import { runCodex } from "./agent/codex";
import { getSession, setSession, deleteSession } from "./agent/session";
import { processTemplates } from "./template";
import { fetchNaverPlaceInfo } from "./tools/navermap";
import { fetchKakaoPlaceInfo } from "./tools/kakaomap";
import { fetchTmapPlaceInfo } from "./tools/tmap";

const bot = new Bot(config.telegramToken);

// 모든 메시지 저장
bot.on("message", async (ctx, next) => {
  if (ctx.message.text) {
    console.log("MSG", JSON.stringify(ctx.message));
    try {
      getDb().run(
        "INSERT INTO messages (chat_id, user_id, first_name, text, date, raw) VALUES (?, ?, ?, ?, ?, ?)",
        [
          ctx.message.chat.id,
          ctx.message.from?.id ?? null,
          ctx.message.from?.first_name ?? null,
          ctx.message.text,
          ctx.message.date,
          JSON.stringify(ctx.message),
        ]
      );
    } catch (err) {
      console.error("DB 메시지 저장 실패:", err);
    }
  }
  await next();
});

bot.on("message:text", async (ctx) => {
  const chatId = ctx.message.chat.id;
  const text = ctx.message.text;
  const name = ctx.message.from.first_name;
  const isGroup = ctx.message.chat.type === "group" || ctx.message.chat.type === "supergroup";

  const sessionKey = `chat:${chatId}`;

  if (text.trim() === "세션 재시작") {
    try {
      deleteSession(sessionKey);
    } catch (err) {
      console.error("세션 삭제 실패:", err);
      return ctx.reply("세션 초기화 중 오류가 발생했습니다.");
    }
    return ctx.reply("세션을 초기화했습니다.");
  }

  const MAP_DOMAINS = ["naver.me", "map.naver.com", "tmap.life", "kko.to", "map.kakao.com"];
  const isMapMessage = MAP_DOMAINS.some((d) => text.includes(d));

  const trigger = config.botTriggerName;
  const hasTrigger = text.startsWith(trigger);

  // 그룹챗: 트리거도 없고 지도 링크도 없으면 저장만 하고 종료
  if (isGroup && !hasTrigger && !isMapMessage) return;

  let mapMeta = "";
  const naverUrl = text.match(/https?:\/\/naver\.me\/\S+/)?.[0];
  const kakaoUrl = text.match(/https?:\/\/(?:kko\.to|(?:place\.)?map\.kakao\.com)\/\S+/)?.[0];
  const tmapUrl = text.match(/https?:\/\/tmap\.life\/\S+/)?.[0];

  if (naverUrl) {
    const info = await fetchNaverPlaceInfo(naverUrl);
    if (info) mapMeta = `\n[사전 조회 완료] 주소: ${info.address}`;
  } else if (kakaoUrl) {
    const info = await fetchKakaoPlaceInfo(kakaoUrl);
    if (info) mapMeta = `\n[사전 조회 완료] 주소: ${info.address}`;
  } else if (tmapUrl) {
    const info = await fetchTmapPlaceInfo(tmapUrl);
    if (info) mapMeta = `\n[사전 조회 완료] 주소: ${info.address}`;
  }

  const prompt = isMapMessage && !hasTrigger
    ? `[지도 링크 감지]${mapMeta}\n${text}`
    : hasTrigger ? `${text.slice(trigger.length).trimStart()}${mapMeta}` : text;
  const preview = prompt.slice(0, 160);
  console.log(`[${name}${isGroup ? " (그룹)" : ""}] ${preview}`);

  if (config.noAgent) return ctx.reply("저장됨");

  // 그룹챗: 최근 컨텍스트 조립
  let finalPrompt = prompt;
  if (isGroup) {
    try {
      const contextMins = config.contextMinutes;
      const contextMax = config.contextMaxMessages;
      const since = Math.floor(Date.now() / 1000) - contextMins * 60;
      const rows = getDb().query<{ first_name: string | null; text: string; date: number }, [number, number, number]>(
        `SELECT first_name, text, date FROM messages
         WHERE chat_id = ? AND date >= ? AND text NOT LIKE '${trigger}%'
         ORDER BY date DESC LIMIT ?`
      ).all(chatId, since, contextMax).reverse();

      if (rows.length > 0) {
        const lines = rows.map((r) => {
          const mins = Math.round((Math.floor(Date.now() / 1000) - r.date) / 60);
          return `${r.first_name ?? "unknown"} (${mins}분 전): ${r.text}`;
        });
        finalPrompt = `[최근 그룹 대화 (최근 ${contextMins}분 내 최대 ${contextMax}개)]\n${lines.join("\n")}\n\n[요청]\n${prompt}`;
      }
    } catch (err) {
      console.error("컨텍스트 조회 실패:", err);
      // 컨텍스트 없이 계속 진행
    }
  }

  let resumeId: string | undefined;
  try {
    resumeId = getSession(sessionKey) ?? undefined;
  } catch (err) {
    console.error("세션 조회 실패:", err);
  }

  let result;
  try {
    result = await runCodex(finalPrompt, resumeId);
  } catch (err) {
    console.error(err);
    return ctx.reply("에이전트 실행 중 오류가 발생했습니다.");
  }

  try {
    if (result.threadId && result.threadId !== resumeId) {
      setSession(sessionKey, result.threadId);
    }
  } catch (err) {
    console.error("세션 저장 실패:", err);
  }

  const processed = processTemplates(result.response);
  const messages: string[] = [];
  let textBuffer: string[] = [];

  for (const line of processed.split("\n").map((l) => l.trimEnd())) {
    if (line.startsWith("https://")) {
      if (textBuffer.length > 0) {
        messages.push(textBuffer.join("\n").trim());
        textBuffer = [];
      }
      messages.push(line);
    } else {
      textBuffer.push(line);
    }
  }
  if (textBuffer.join("").trim()) messages.push(textBuffer.join("\n").trim());

  for (const msg of messages) {
    if (!msg) continue;
    const chunks = msg.match(/[\s\S]{1,4096}/g) ?? [];
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  }
});

bot.start();
console.log(`Bot started (trigger: "${config.botTriggerName}")`);
