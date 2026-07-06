import { getDb } from "./db";
import { config } from "./config";
import type { Messenger, Platform } from "./messenger/types";

let _registry = new Map<Platform, Messenger>();

export type RepeatUnit = "minute" | "hour" | "day" | "week" | "month" | "weekdays";
export type RepeatSpec = { unit: RepeatUnit; interval: number; count?: number; until?: number };

type AlarmRow = {
  id: number;
  chat_id: string;
  fire_at: number;
  content: string;
  platform: Platform;
  repeat_unit: RepeatUnit | null;
  repeat_interval: number | null;
  repeat_count: number | null;
  repeat_until: number | null;
  repeat_dom: number | null;
};

export function registerAlarm(
  chatId: string,
  fireAt: number,
  content: string,
  platform: Platform,
  spec?: RepeatSpec | null
): void {
  const repeatDom = spec?.unit === "month" ? getDomInTz(fireAt, config.timezone) : null;
  const result = getDb().run(
    `INSERT INTO alarms
      (chat_id, fire_at, content, platform, repeat_dom, repeat_unit, repeat_interval, repeat_count, repeat_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      chatId,
      fireAt,
      content,
      platform,
      repeatDom,
      spec?.unit ?? null,
      spec?.interval ?? null,
      spec?.count ?? null,
      spec?.until ?? null,
    ]
  );
  scheduleAlarm(Number(result.lastInsertRowid), fireAt, chatId, content, platform, spec ?? null, repeatDom);
}

export function initAlarms(registry: Map<Platform, Messenger>): void {
  _registry = registry;

  const pending = getDb()
    .query<AlarmRow, []>(
      `SELECT id, chat_id, fire_at, content, platform, repeat_dom,
        repeat_unit, repeat_interval, repeat_count, repeat_until
       FROM alarms WHERE sent = 0`
    )
    .all();

  for (const alarm of pending) {
    const spec = rowRepeatSpec(alarm);
    scheduleAlarm(
      alarm.id,
      alarm.fire_at,
      alarm.chat_id,
      alarm.content,
      alarm.platform,
      spec,
      alarm.repeat_dom
    );
  }
  if (pending.length > 0) console.log(`[alarm] ${pending.length}개 알람 복구됨`);

  // safety-net: setTimeout이 누락됐을 경우를 위한 폴링 (5분)
  setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    const missed = getDb()
      .query<AlarmRow, [number]>(
        `SELECT id, chat_id, fire_at, content, platform, repeat_dom,
          repeat_unit, repeat_interval, repeat_count, repeat_until
         FROM alarms WHERE fire_at <= ? AND sent = 0`
      )
      .all(now);

    for (const alarm of missed) {
      console.warn(`[alarm] safety-net 발송: id=${alarm.id}`);
      fire(alarm.id, alarm.fire_at, alarm.chat_id, alarm.content, alarm.platform, rowRepeatSpec(alarm), alarm.repeat_dom);
    }
  }, 5 * 60_000);
}

function rowRepeatSpec(row: Pick<AlarmRow, "repeat_unit" | "repeat_interval" | "repeat_count" | "repeat_until">): RepeatSpec | null {
  if (!row.repeat_unit || !row.repeat_interval) return null;
  return {
    unit: row.repeat_unit,
    interval: row.repeat_interval,
    count: row.repeat_count ?? undefined,
    until: row.repeat_until ?? undefined,
  };
}

const MAX_TIMEOUT_MS = 2 ** 31 - 1; // ~24.8일, setTimeout 32비트 한계

function scheduleAlarm(
  id: number,
  fireAt: number,
  chatId: string,
  content: string,
  platform: Platform,
  spec: RepeatSpec | null,
  repeatDom: number | null
): void {
  const delay = fireAt * 1000 - Date.now();
  if (delay <= 0) {
    fire(id, fireAt, chatId, content, platform, spec, repeatDom);
  } else if (delay <= MAX_TIMEOUT_MS) {
    setTimeout(() => fire(id, fireAt, chatId, content, platform, spec, repeatDom), delay);
  }
  // 초과 시 safety-net 폴링(5분)에 위임
}

export function fire(
  id: number,
  scheduledAt: number,
  chatId: string,
  content: string,
  platform: Platform,
  spec: RepeatSpec | null,
  repeatDom: number | null
): void {
  // setTimeout이 지연된 사이 취소됐을 경우 대비
  const row = getDb()
    .query<{ sent: number }, [number]>("SELECT sent FROM alarms WHERE id = ?")
    .get(id);
  if (!row || row.sent === 1) return;

  if (spec) {
    const newCount = spec.count != null ? spec.count - 1 : null;
    if (newCount != null && newCount <= 0) {
      getDb().run("UPDATE alarms SET sent = 1, repeat_count = ? WHERE id = ?", [newCount, id]);
    } else {
      const nextAt = nextFireAt(scheduledAt, spec.unit, spec.interval, repeatDom, config.timezone);
      if (spec.until != null && nextAt > spec.until) {
        getDb().run("UPDATE alarms SET sent = 1, repeat_count = ? WHERE id = ?", [newCount, id]);
      } else {
        getDb().run("UPDATE alarms SET fire_at = ?, repeat_count = ? WHERE id = ?", [nextAt, newCount, id]);
        scheduleAlarm(id, nextAt, chatId, content, platform, { ...spec, count: newCount ?? undefined }, repeatDom);
      }
    }
  } else {
    getDb().run("UPDATE alarms SET sent = 1 WHERE id = ?", [id]);
  }

  const messenger = _registry.get(platform);
  if (!messenger) {
    console.warn(`[alarm] messenger not running for platform=${platform}, skip alarm id=${id}`);
    return;
  }

  messenger
    .sendText(chatId, `⏰ ${content}`)
    .catch((err) => console.error("알람 발송 실패:", err));
}

function getDomInTz(unixSec: number, tz: string): number {
  return Number(
    new Date(unixSec * 1000).toLocaleDateString("en-US", { timeZone: tz, day: "numeric" })
  );
}

export function nextFireAt(
  scheduledAt: number,
  unit: RepeatUnit,
  interval: number,
  repeatDom: number | null,
  tz: string
): number {
  switch (unit) {
    case "minute":
      return scheduledAt + interval * 60;
    case "hour":
      return scheduledAt + interval * 3600;
    case "day":
      return scheduledAt + interval * 86400;
    case "week":
      return scheduledAt + interval * 7 * 86400;
    case "weekdays": {
      let next = scheduledAt + 86400;
      for (let i = 0; i < 7; i++) {
        const dow = new Date(next * 1000).toLocaleDateString("en-US", {
          timeZone: tz,
          weekday: "short",
        });
        if (!["Sat", "Sun"].includes(dow)) break;
        next += 86400;
      }
      return next;
    }
    case "month": {
      const d = new Date(scheduledAt * 1000);
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).formatToParts(d);

      const get = (type: string) =>
        Number(parts.find((p) => p.type === type)?.value ?? "0");
      let year = get("year");
      let month = get("month");
      const hour = get("hour");
      const minute = get("minute");
      const second = get("second");

      month += interval;
      while (month > 12) {
        month -= 12;
        year += 1;
      }

      // clamp: new Date(year, month, 0) = last day of target month
      const lastDay = new Date(year, month, 0).getDate();
      const dom = Math.min(repeatDom ?? get("day"), lastDay);

      const iso = [
        `${year}-${String(month).padStart(2, "0")}-${String(dom).padStart(2, "0")}`,
        `T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`,
      ].join("");

      // 현재 시각 기준 오프셋 (Asia/Seoul은 DST 없음)
      const utcMs = new Date(d.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
      const tzMs = new Date(d.toLocaleString("en-US", { timeZone: tz })).getTime();
      const offsetMin = Math.round((tzMs - utcMs) / 60000);
      const sign = offsetMin >= 0 ? "+" : "-";
      const abs = Math.abs(offsetMin);
      const hh = String(Math.floor(abs / 60)).padStart(2, "0");
      const mm = String(abs % 60).padStart(2, "0");

      return Math.floor(new Date(`${iso}${sign}${hh}:${mm}`).getTime() / 1000);
    }
  }
}
