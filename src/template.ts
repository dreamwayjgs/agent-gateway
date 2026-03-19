import { config } from "./config";

const HANDLERS: Record<string, (value: string) => string> = {
  주소: (v) => v,
  네이버지도: (v) => `https://map.naver.com/p/search/${encodeURIComponent(v)}`,
  카카오지도: (v) => `https://map.kakao.com/link/search/${encodeURIComponent(v)}`,
  티맵: (v) =>
    config.tmapAppKey
      ? `https://apis.openapi.sk.com/tmap/app/poi?appKey=${config.tmapAppKey}&name=${encodeURIComponent(v)}`
      : "(TMAP 키 미설정)",
};

const TEMPLATE_RE = /\{\{([^:}]+):([^}]+)\}\}/g;

export function processTemplates(text: string): string {
  return text.replace(TEMPLATE_RE, (_, service, value) => {
    const handler = HANDLERS[service.trim()];
    return handler ? handler(value.trim()) : value.trim();
  });
}
