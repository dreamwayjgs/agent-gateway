import { config } from "./config";
import { getDb } from "./db";
import { registerAlarm, type RepeatType } from "./alarm";

const HANDLERS: Record<string, (value: string) => string> = {
  주소: (v) => v,
  네이버지도: (v) => `https://map.naver.com/p/search/${encodeURIComponent(v)}`,
  카카오지도: (v) => `https://map.kakao.com/link/search/${encodeURIComponent(v)}`,
  티맵: (v) =>
    config.tmapAppKey
      ? `https://apis.openapi.sk.com/tmap/app/poi?appKey=${config.tmapAppKey}&name=${encodeURIComponent(v)}`
      : "(TMAP 키 미설정)",
};

export // TZ 오프셋 없는 bare ISO에 ianaTimezone 기준 오프셋을 붙여 반환.
// 이미 오프셋이 있는 ISO(Z, ±HH:MM, ±HHMM)는 그대로 반환.
// 잘못된 ianaTimezone 값이면 원본 iso를 그대로 반환해 isNaN 분기로 degrade.
function resolveIso(iso: string, ianaTimezone: string): string {
  if (/Z$|[+-]\d{2}:\d{2}$|[+-]\d{4}$/.test(iso)) return iso;
  try {
    // 주의: now 기준 offset 사용. DST가 있는 타임존에서 알람 시각이
    // 다른 DST 구간이면 offset이 1시간 어긋날 수 있음. Asia/Seoul(DST 없음)에서는 무관.
    const now = new Date();
    const utcMs = new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
    const tzMs = new Date(now.toLocaleString("en-US", { timeZone: ianaTimezone })).getTime();
    const offsetMin = (tzMs - utcMs) / 60000;
    const sign = offsetMin >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMin);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    return `${iso}${sign}${hh}:${mm}`;
  } catch {
    return iso;
  }
}

const VALID_REPEATS = new Set<string>(["daily", "weekly", "weekdays", "monthly"]);

function parseRepeat(val: string | undefined): RepeatType | undefined {
  if (!val) return undefined;
  const v = val.trim().toLowerCase();
  return VALID_REPEATS.has(v) ? (v as RepeatType) : undefined;
}

function repeatLabelKo(repeat: string): string {
  const labels: Record<string, string> = {
    daily: "매일",
    weekly: "매주",
    weekdays: "주중매일",
    monthly: "매월",
  };
  return labels[repeat] ?? repeat;
}

// {{알람:ISO8601|내용}} 또는 {{알람:ISO8601|내용|반복유형}}
const ALARM_RE = /\{\{알람:([^|}\s]+)\|([^|}]+)(?:\|([^}]+))?\}\}/g;
const ALARM_LIST_RE = /\{\{알람목록\}\}/g;
const ALARM_CANCEL_RE = /\{\{알람취소:(\d+)\}\}/g;

export function extractAlarms(text: string, chatId: number): string {
  // 1. 알람 등록
  let result = text.replace(ALARM_RE, (_, iso, content, repeatRaw) => {
    const repeat = parseRepeat(repeatRaw);
    const fireAt = Math.floor(new Date(resolveIso(iso, config.timezone)).getTime() / 1000);
    if (isNaN(fireAt)) return `[알람 등록 실패: 시간 파싱 오류 — ${iso}]`;
    registerAlarm(chatId, fireAt, content.trim(), repeat);
    const timeStr = new Date(fireAt * 1000).toLocaleString("ko-KR", {
      timeZone: config.timezone,
      hour12: false,
    });
    const label = repeat ? ` (${repeatLabelKo(repeat)})` : "";
    return `⏰ 알람 등록됨: ${timeStr}${label} | ${content.trim()}`;
  });

  // 2. 알람 목록
  result = result.replace(ALARM_LIST_RE, () => {
    const now = Math.floor(Date.now() / 1000);
    const rows = getDb()
      .query<
        { id: number; fire_at: number; content: string; repeat: string | null },
        [number, number]
      >(
        "SELECT id, fire_at, content, repeat FROM alarms WHERE chat_id = ? AND sent = 0 AND fire_at > ? ORDER BY fire_at ASC"
      )
      .all(chatId, now);
    if (rows.length === 0) return "예정된 알람이 없습니다.";
    return rows
      .map((r) => {
        const timeStr = new Date(r.fire_at * 1000).toLocaleString("ko-KR", {
          timeZone: config.timezone,
          hour12: false,
        });
        const label = r.repeat ? ` [${repeatLabelKo(r.repeat)}]` : "";
        return `#${r.id} ${timeStr}${label} — ${r.content}`;
      })
      .join("\n");
  });

  // 3. 알람 취소
  result = result.replace(ALARM_CANCEL_RE, (_, idStr) => {
    const id = Number(idStr);
    const alarm = getDb()
      .query<{ id: number }, [number, number]>(
        "SELECT id FROM alarms WHERE id = ? AND chat_id = ? AND sent = 0"
      )
      .get(id, chatId);
    if (!alarm) return `[알람 #${id} 없음 또는 이미 완료]`;
    getDb().run("UPDATE alarms SET sent = 1 WHERE id = ?", [id]);
    return `알람 #${id} 취소됨`;
  });

  return result;
}

const TEMPLATE_RE = /\{\{([^:}]+):([^}]+)\}\}/g;

export function processTemplates(text: string): string {
  return text.replace(TEMPLATE_RE, (_, service, value) => {
    const handler = HANDLERS[service.trim()];
    return handler ? handler(value.trim()) : value.trim();
  });
}
