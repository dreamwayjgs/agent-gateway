import { config } from "./config";
import { getDb } from "./db";
import { registerAlarm, type RepeatSpec, type RepeatUnit } from "./alarm";
import type { Platform } from "./messenger/types";

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

const NAMED_REPEATS: Record<string, RepeatSpec> = {
  daily: { unit: "day", interval: 1 },
  weekly: { unit: "week", interval: 1 },
  weekdays: { unit: "weekdays", interval: 1 },
  monthly: { unit: "month", interval: 1 },
};

function parseRepeatSpec(val: string | undefined): { spec: RepeatSpec | null; error?: string } {
  if (!val) return { spec: null };
  const tokens = val.split("|").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (tokens.length === 0) return { spec: null };

  let spec: RepeatSpec | null = null;
  const repeatToken = tokens[0];
  if (NAMED_REPEATS[repeatToken]) {
    spec = { ...NAMED_REPEATS[repeatToken] };
  } else {
    const every = repeatToken.match(/^every=(\d+)(m|h|d|w|mo)$/);
    if (!every) return { spec: null, error: `반복 형식 오류 — ${repeatToken}` };
    const interval = Number(every[1]);
    if (!Number.isInteger(interval) || interval <= 0) return { spec: null, error: `반복 간격 오류 — ${repeatToken}` };
    const unitMap: Record<string, RepeatUnit> = { m: "minute", h: "hour", d: "day", w: "week", mo: "month" };
    spec = { unit: unitMap[every[2]], interval };
  }

  for (const token of tokens.slice(1)) {
    const count = token.match(/^count=(\d+)$/);
    if (count) {
      const value = Number(count[1]);
      if (!Number.isInteger(value) || value <= 0) return { spec: null, error: `반복 횟수 오류 — ${token}` };
      spec.count = value;
      continue;
    }

    const until = token.match(/^until=(.+)$/);
    if (until) {
      const epoch = Math.floor(new Date(resolveIso(until[1], config.timezone)).getTime() / 1000);
      if (isNaN(epoch)) return { spec: null, error: `반복 종료일 오류 — ${until[1]}` };
      spec.until = epoch;
      continue;
    }

    return { spec: null, error: `반복 옵션 오류 — ${token}` };
  }

  return { spec };
}

export function repeatLabelKo(spec: RepeatSpec | null): string {
  if (!spec) return "-";
  const unitLabels: Record<RepeatUnit, string> = {
    minute: "분",
    hour: "시간",
    day: "일",
    week: "주",
    month: "개월",
    weekdays: "주중매일",
  };
  const base = spec.unit === "weekdays"
    ? "주중매일"
    : spec.interval === 1
      ? ({ minute: "매분", hour: "매시간", day: "매일", week: "매주", month: "매월" } as Record<Exclude<RepeatUnit, "weekdays">, string>)[spec.unit]
      : `${spec.interval}${unitLabels[spec.unit]}마다`;
  const count = spec.count != null ? ` ${spec.count}회` : "";
  const until = spec.until != null
    ? ` ~${new Date(spec.until * 1000).toLocaleDateString("ko-KR", { timeZone: config.timezone })}까지`
    : "";
  return `${base}${count}${until}`;
}

// {{알람:ISO8601|내용}} 또는 {{알람:ISO8601|내용|반복유형}}
const ALARM_RE = /\{\{알람:([^|}\s]+)\|([^|}]+)(?:\|([^}]+))?\}\}/g;
const ALARM_LIST_RE = /\{\{알람목록\}\}/g;
const ALARM_CANCEL_RE = /\{\{알람취소:(\d+)\}\}/g;

export function extractAlarms(text: string, chatId: string, platform: Platform): string {
  // 1. 알람 등록
  let result = text.replace(ALARM_RE, (_, iso, content, repeatRaw) => {
    const parsed = parseRepeatSpec(repeatRaw);
    if (parsed.error) return `[알람 등록 실패: ${parsed.error}]`;
    const fireAt = Math.floor(new Date(resolveIso(iso, config.timezone)).getTime() / 1000);
    if (isNaN(fireAt)) return `[알람 등록 실패: 시간 파싱 오류 — ${iso}]`;
    registerAlarm(chatId, fireAt, content.trim(), platform, parsed.spec);
    const timeStr = new Date(fireAt * 1000).toLocaleString("ko-KR", {
      timeZone: config.timezone,
      hour12: false,
    });
    const label = parsed.spec ? ` (${repeatLabelKo(parsed.spec)})` : "";
    return `⏰ 알람 등록됨: ${timeStr}${label} | ${content.trim()}`;
  });

  // 2. 알람 목록
  result = result.replace(ALARM_LIST_RE, () => {
    const now = Math.floor(Date.now() / 1000);
    const rows = getDb()
      .query<
        {
          id: number;
          fire_at: number;
          content: string;
          repeat_unit: RepeatUnit | null;
          repeat_interval: number | null;
          repeat_count: number | null;
          repeat_until: number | null;
        },
        [string, Platform, number]
      >(
        `SELECT id, fire_at, content, repeat_unit, repeat_interval, repeat_count, repeat_until
         FROM alarms WHERE chat_id = ? AND platform = ? AND sent = 0 AND fire_at > ? ORDER BY fire_at ASC`
      )
      .all(chatId, platform, now);
    if (rows.length === 0) return "예정된 알람이 없습니다.";
    return rows
      .map((r) => {
        const timeStr = new Date(r.fire_at * 1000).toLocaleString("ko-KR", {
          timeZone: config.timezone,
          hour12: false,
        });
        const spec = r.repeat_unit && r.repeat_interval
          ? { unit: r.repeat_unit, interval: r.repeat_interval, count: r.repeat_count ?? undefined, until: r.repeat_until ?? undefined }
          : null;
        const label = spec ? ` [${repeatLabelKo(spec)}]` : "";
        return `#${r.id} ${timeStr}${label} — ${r.content}`;
      })
      .join("\n");
  });

  // 3. 알람 취소
  result = result.replace(ALARM_CANCEL_RE, (_, idStr) => {
    const id = Number(idStr);
    const alarm = getDb()
      .query<{ id: number }, [number, string, Platform]>(
        "SELECT id FROM alarms WHERE id = ? AND chat_id = ? AND platform = ? AND sent = 0"
      )
      .get(id, chatId, platform);
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
