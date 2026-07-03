import { getDb } from "./db";
import { config } from "./config";
import { runCodex, AgentTimeoutError as CodexTimeoutError } from "./agent/codex";
import { runGemini, AgentTimeoutError as GeminiTimeoutError } from "./agent/gemini";
import { runOpencode, AgentTimeoutError as OpencodeTimeoutError } from "./agent/opencode";
import { getSession, setSession, deleteSession } from "./agent/session";
import { processTemplates, extractAlarms } from "./template";
import { initAlarms } from "./alarm";
import { getHelpText } from "./help";
import { downloadAndSaveFile, tryUpdateMemo, extractFileRefs } from "./files";
import { getChatSettings, updateChatSettings } from "./chat-settings";
import { transcribeAndTranslate, saveVoiceLog, LANG_LABELS } from "./translate";
import { fetchNaverPlaceInfo } from "./tools/navermap";
import { fetchKakaoPlaceInfo } from "./tools/kakaomap";
import { fetchTmapPlaceInfo } from "./tools/tmap";
import { getGuroContext, processGuroTemplates } from "./tools/guro";
import { createMessengers } from "./messenger";
import { safeChatSegment } from "./util";
import type { IncomingMsg, Messenger, OutFile } from "./messenger/types";

const TRIGGER_ALIASES = ["$ ", "% "];

export function sessionKeyFor(msg: Pick<IncomingMsg, "platform" | "chatId">): string {
  return `chat:${msg.platform}:${msg.chatId}`;
}

// 모든 텍스트 메시지 저장 (원본 동작: text 있을 때만 저장)
function saveIncoming(msg: IncomingMsg): void {
  if (msg.text == null) return;
  try {
    getDb().run(
      "INSERT INTO messages (chat_id, user_id, first_name, text, date, raw) VALUES (?, ?, ?, ?, ?, ?)",
      [
        msg.chatId,
        msg.userId,
        msg.userName,
        msg.text,
        msg.date,
        JSON.stringify(msg.raw),
      ]
    );
  } catch (err) {
    console.error("DB 메시지 저장 실패:", err);
  }
}

async function handleFiles(msg: IncomingMsg, messenger: Messenger): Promise<void> {
  const chatId = msg.chatId;
  const uploadedBy = msg.userName;
  const uploadedAt = msg.date;
  const caption = msg.caption;

  for (const file of msg.files) {
    try {
      const saved = await downloadAndSaveFile(
        (ref) => messenger.downloadFile(ref),
        file.id,
        file.fileName,
        file.mimeType,
        chatId,
        uploadedBy,
        caption,
        uploadedAt
      );
      const memoNote = caption ? ` (메모: ${caption})` : " — 메모: ## 뒤에 내용을 입력하세요.";
      console.log(`[파일 저장] #${saved.id} ${saved.localPath}`);
      await messenger.sendText(msg.chatId, `📎 저장됨: ${file.fileName}${memoNote}`);
    } catch (err) {
      console.error("파일 저장 실패:", err);
      await messenger.sendText(msg.chatId, "파일 저장 중 오류가 발생했습니다.");
    }
  }
}

async function handleVoice(msg: IncomingMsg, messenger: Messenger): Promise<void> {
  const chatId = msg.chatId;
  const settings = getChatSettings(chatId);
  if (!settings.translation?.enabled) return;

  const target = settings.translation.target;
  const voice = msg.voice!;

  // 파일 다운로드
  let localPath: string;
  try {
    const { buffer } = await messenger.downloadFile(voice);

    const { join } = await import("node:path");
    const { mkdir } = await import("node:fs/promises");
    const dir = join(config.workspaceDir, "voice", safeChatSegment(chatId));
    await mkdir(dir, { recursive: true });
    localPath = join(dir, `${msg.date}_voice.ogg`);
    await Bun.write(localPath, buffer);
  } catch (err) {
    console.error("[음성] 다운로드 실패:", err);
    return messenger.sendText(msg.chatId, "음성 파일 다운로드에 실패했습니다.");
  }

  await messenger.sendTyping(msg.chatId);

  try {
    const result = await transcribeAndTranslate(localPath, target, config.geminiApiKey);
    saveVoiceLog(chatId, voice.id, localPath, result, target);
    await messenger.sendText(msg.chatId, `${result.transcript}\n\n${result.translation}`);
  } catch (err) {
    console.error("[음성] 번역 실패:", err);
    await messenger.sendText(msg.chatId, "음성 번역 중 오류가 발생했습니다.");
  }
}

async function handleText(msg: IncomingMsg, messenger: Messenger): Promise<void> {
  const chatId = msg.chatId;
  const text = msg.text!;
  const name = msg.userName ?? "";
  const isGroup = msg.isGroup;
  console.log(`[recv] ${name} (${chatId}): ${text.slice(0, 80)}`);

  const sessionKey = sessionKeyFor(msg);

  const HELP_TRIGGERS = ["도움말", "help", "헬프", "뭐하지", '머하지', "뭐 할 수 있어", "뭐할수있어", "?"];
  if (HELP_TRIGGERS.some((t) => text.trim().toLowerCase() === t)) {
    return messenger.sendText(chatId, getHelpText(TRIGGER_ALIASES));
  }

  if (tryUpdateMemo(chatId, text.trim())) {
    return messenger.sendText(chatId, "메모가 업데이트됐습니다.");
  }

  if (text.trim() === "세션 재시작") {
    try {
      deleteSession(sessionKey);
    } catch (err) {
      console.error("세션 삭제 실패:", err);
      return messenger.sendText(chatId, "세션 초기화 중 오류가 발생했습니다.");
    }
    return messenger.sendText(chatId, "세션을 초기화했습니다.");
  }

  // 번역 명령 인터셉트 (% 번역 on [lang] / off)
  const translationCmdAlias = TRIGGER_ALIASES.find((a) => text.startsWith(a));
  if (translationCmdAlias) {
    const body = text.slice(translationCmdAlias.length).trimStart();
    const onMatch = body.match(/^번역\s+(on|시작)(?:\s+(\w+))?$/i);
    const offMatch = body.match(/^번역\s+(off|종료)$/i);

    if (onMatch) {
      if (!config.geminiApiKey) {
        return messenger.sendText(chatId, "번역 기능을 사용하려면 GEMINI_API_KEY가 필요합니다.");
      }
      const target = onMatch[2] ?? "en";
      updateChatSettings(chatId, { translation: { enabled: true, target } });
      const label = LANG_LABELS[target] ?? target;
      return messenger.sendText(chatId, `번역 모드 켜짐 (한국어 ↔ ${label})`);
    }

    if (offMatch) {
      updateChatSettings(chatId, { translation: { enabled: false, target: "en" } });
      return messenger.sendText(chatId, "번역 모드 꺼짐");
    }
  }

  const MAP_DOMAINS = ["naver.me", "map.naver.com", "tmap.life", "kko.to", "map.kakao.com"];
  const isMapMessage = MAP_DOMAINS.some((d) => text.includes(d));

  const trigger = config.botTriggerName;
  const matchedAlias = TRIGGER_ALIASES.find((a) => text.startsWith(a));
  const hasTrigger = text.startsWith(trigger) || !!matchedAlias;
  const triggerLen = matchedAlias ? matchedAlias.length : trigger.length;

  // 트리거도 없고 지도 링크도 없으면 저장만 하고 종료
  if (!hasTrigger && !isMapMessage) return;

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
    : hasTrigger ? `${text.slice(triggerLen).trimStart()}${mapMeta}` : text;
  const preview = prompt.slice(0, 160);
  const reqStart = Date.now();
  console.log(`[${name}${isGroup ? " (그룹)" : ""}] ${preview}`);

  if (config.noAgent) return messenger.sendText(chatId, "저장됨");

  // 그룹챗: 최근 컨텍스트 조립
  let finalPrompt = prompt;
  if (isGroup) {
    try {
      const contextMins = config.contextMinutes;
      const contextMax = config.contextMaxMessages;
      const since = Math.floor(Date.now() / 1000) - contextMins * 60;
      const rows = getDb().query<{ first_name: string | null; text: string; date: number }, [string, number, number]>(
        `SELECT first_name, text, date FROM messages
         WHERE chat_id = ? AND role = 'user' AND date >= ? AND text NOT LIKE '${trigger}%' AND text NOT LIKE '$ %' AND text NOT LIKE '% %'
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

  const nowKst = new Date().toLocaleString("ko-KR", {
    timeZone: config.timezone,
    hour12: false,
  });
  finalPrompt = `[현재 시각: ${nowKst}] [채팅 ID: ${chatId}]\n\n${finalPrompt}`;

  const PARKING_KEYWORDS = ["주차", "방문차량", "크레딧"];
  if (PARKING_KEYWORDS.some((k) => prompt.includes(k))) {
    try {
      const guroCtx = await getGuroContext();
      finalPrompt += `\n\n${guroCtx}`;
    } catch (err) {
      console.error("[주차] 컨텍스트 조회 실패:", err);
    }
  }

  let resumeId: string | undefined;
  try {
    resumeId = getSession(sessionKey, config.agentBackend) ?? undefined;
  } catch (err) {
    console.error("세션 조회 실패:", err);
  }

  await messenger.sendTyping(chatId);

  let result: { response: string; sessionId: string };
  try {
    if (config.agentBackend === "gemini") {
      const r = await runGemini(finalPrompt, resumeId);
      result = { response: r.response, sessionId: r.sessionId };
    } else if (config.agentBackend === "opencode") {
      const r = await runOpencode(finalPrompt, resumeId);
      result = { response: r.response, sessionId: r.sessionId };
    } else {
      const r = await runCodex(finalPrompt, resumeId);
      result = { response: r.response, sessionId: r.threadId };
    }
  } catch (err) {
    console.error(err);
    if (err instanceof CodexTimeoutError || err instanceof GeminiTimeoutError || err instanceof OpencodeTimeoutError) {
      return messenger.sendText(chatId, "응답 시간이 너무 오래 걸려 중단했습니다.");
    }
    return messenger.sendText(chatId, "에이전트 실행 중 오류가 발생했습니다.");
  }
  console.log(`[${name}${isGroup ? " (그룹)" : ""}] ${Date.now() - reqStart}ms`);

  try {
    if (result.sessionId && result.sessionId !== resumeId) {
      setSession(sessionKey, result.sessionId, config.agentBackend);
    }
  } catch (err) {
    console.error("세션 저장 실패:", err);
  }

  try {
    getDb().run(
      "INSERT INTO messages (chat_id, user_id, first_name, text, date, raw, role) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        chatId,
        null,
        config.botTriggerName,
        result.response,
        Math.floor(Date.now() / 1000),
        JSON.stringify({ sessionId: result.sessionId, backend: config.agentBackend }),
        "assistant",
      ]
    );
  } catch (err) {
    console.error("DB 응답 저장 실패:", err);
  }

  const { cleaned, refs } = extractFileRefs(result.response, chatId);
  const afterGuro = await processGuroTemplates(cleaned);
  const processed = processTemplates(extractAlarms(afterGuro, chatId, msg.platform));
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

  for (const out of messages) {
    if (!out) continue;
    await messenger.sendText(chatId, out); // 4096 분할은 어댑터 내부
  }

  for (const ref of refs) {
    try {
      const data = await Bun.file(ref.localPath).bytes();
      const mime = ref.mimeType ?? "";
      let kind: OutFile["kind"];
      if (mime === "image/gif") {
        kind = "animation";
      } else if (mime.startsWith("image/")) {
        kind = "photo";
      } else if (mime.startsWith("video/")) {
        kind = "video";
      } else if (mime.startsWith("audio/")) {
        kind = "audio";
      } else {
        kind = "document";
      }
      await messenger.sendFile(chatId, { data, fileName: ref.fileName, kind });
    } catch (err) {
      console.error(`파일 전송 실패 #${ref.id}:`, err);
      await messenger.sendText(chatId, `파일 전송 실패: ${ref.fileName}`);
    }
  }
}

export async function handleMessage(msg: IncomingMsg, messenger: Messenger): Promise<void> {
  saveIncoming(msg);

  if (msg.voice) return handleVoice(msg, messenger);
  if (msg.files.length > 0) return handleFiles(msg, messenger);
  if (msg.text != null) return handleText(msg, messenger);
}

// 봇 기동 — import 시(테스트 등)에는 실행하지 않음
if (import.meta.main) {
  const messengers = createMessengers(config.messengers);
  const registry = new Map(messengers.map((m) => [m.platform, m]));
  for (const messenger of messengers) {
    messenger.onMessage((m) => handleMessage(m, messenger));
  }
  for (const messenger of messengers) {
    await messenger.start();
  }
  initAlarms(registry);
  console.log(`Bot started (trigger: "${config.botTriggerName}", backend: ${config.agentBackend})`);
}
