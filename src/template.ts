import { config } from "./config";
import { registerAlarm } from "./alarm";

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

// {{알람:ISO8601|내용}} 을 먼저 추출해 DB 저장 후 확인 문구로 교체
const ALARM_RE = /\{\{알람:([^|}\s]+)\|([^}]+)\}\}/g;

export function extractAlarms(text: string, chatId: number): string {
  return text.replace(ALARM_RE, (_, iso, content) => {
    const fireAt = Math.floor(new Date(resolveIso(iso, config.timezone)).getTime() / 1000);
    if (isNaN(fireAt)) return `[알람 등록 실패: 시간 파싱 오류 — ${iso}]`;
    registerAlarm(chatId, fireAt, content.trim());
    const timeStr = new Date(fireAt * 1000).toLocaleString("ko-KR", {
      timeZone: config.timezone,
      hour12: false,
    });
    return `⏰ 알람 등록됨: ${timeStr} | ${content.trim()}`;
  });
}

const TEMPLATE_RE = /\{\{([^:}]+):([^}]+)\}\}/g;

export function processTemplates(text: string): string {
  return text.replace(TEMPLATE_RE, (_, service, value) => {
    const handler = HANDLERS[service.trim()];
    return handler ? handler(value.trim()) : value.trim();
  });
}
