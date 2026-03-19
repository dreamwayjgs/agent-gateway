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

// {{알람:ISO8601|내용}} 을 먼저 추출해 DB 저장 후 확인 문구로 교체
const ALARM_RE = /\{\{알람:([^|}\s]+)\|([^}]+)\}\}/g;

export function extractAlarms(text: string, chatId: number): string {
  return text.replace(ALARM_RE, (_, iso, content) => {
    const fireAt = Math.floor(new Date(iso).getTime() / 1000);
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
