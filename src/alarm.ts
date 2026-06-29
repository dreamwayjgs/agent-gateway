import { getDb } from "./db";
import { config } from "./config";
import type { Messenger } from "./messenger/types";

let _msgr: Messenger | null = null;

export type RepeatType = "daily" | "weekly" | "weekdays" | "monthly";

export function registerAlarm(
  chatId: string,
  fireAt: number,
  content: string,
  repeat?: RepeatType
): void {
  const repeatDom = repeat === "monthly" ? getDomInTz(fireAt, config.timezone) : null;
  const result = getDb().run(
    "INSERT INTO alarms (chat_id, fire_at, content, repeat, repeat_dom) VALUES (?, ?, ?, ?, ?)",
    [chatId, fireAt, content, repeat ?? null, repeatDom]
  );
  scheduleAlarm(Number(result.lastInsertRowid), fireAt, chatId, content, repeat ?? null, repeatDom);
}

export function initAlarms(messenger: Messenger): void {
  _msgr = messenger;

  const pending = getDb()
    .query<
      {
        id: number;
        chat_id: string;
        fire_at: number;
        content: string;
        repeat: string | null;
        repeat_dom: number | null;
      },
      []
    >("SELECT id, chat_id, fire_at, content, repeat, repeat_dom FROM alarms WHERE sent = 0")
    .all();

  for (const alarm of pending) {
    scheduleAlarm(
      alarm.id,
      alarm.fire_at,
      alarm.chat_id,
      alarm.content,
      alarm.repeat as RepeatType | null,
      alarm.repeat_dom
    );
  }
  if (pending.length > 0) console.log(`[alarm] ${pending.length}개 알람 복구됨`);

  // safety-net: setTimeout이 누락됐을 경우를 위한 폴링 (5분)
  setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    const missed = getDb()
      .query<
        {
          id: number;
          chat_id: string;
          fire_at: number;
          content: string;
          repeat: string | null;
          repeat_dom: number | null;
        },
        [number]
      >("SELECT id, chat_id, fire_at, content, repeat, repeat_dom FROM alarms WHERE fire_at <= ? AND sent = 0")
      .all(now);

    for (const alarm of missed) {
      console.warn(`[alarm] safety-net 발송: id=${alarm.id}`);
      fire(alarm.id, alarm.fire_at, alarm.chat_id, alarm.content, alarm.repeat as RepeatType | null, alarm.repeat_dom);
    }
  }, 5 * 60_000);
}

const MAX_TIMEOUT_MS = 2 ** 31 - 1; // ~24.8일, setTimeout 32비트 한계

function scheduleAlarm(
  id: number,
  fireAt: number,
  chatId: string,
  content: string,
  repeat: RepeatType | null,
  repeatDom: number | null
): void {
  const delay = fireAt * 1000 - Date.now();
  if (delay <= 0) {
    fire(id, fireAt, chatId, content, repeat, repeatDom);
  } else if (delay <= MAX_TIMEOUT_MS) {
    setTimeout(() => fire(id, fireAt, chatId, content, repeat, repeatDom), delay);
  }
  // 초과 시 safety-net 폴링(5분)에 위임
}

function fire(
  id: number,
  scheduledAt: number,
  chatId: string,
  content: string,
  repeat: RepeatType | null,
  repeatDom: number | null
): void {
  // setTimeout이 지연된 사이 취소됐을 경우 대비
  const row = getDb()
    .query<{ sent: number }, [number]>("SELECT sent FROM alarms WHERE id = ?")
    .get(id);
  if (!row || row.sent === 1) return;

  if (repeat) {
    const nextAt = nextFireAt(scheduledAt, repeat, repeatDom, config.timezone);
    getDb().run("UPDATE alarms SET fire_at = ? WHERE id = ?", [nextAt, id]);
    scheduleAlarm(id, nextAt, chatId, content, repeat, repeatDom);
  } else {
    getDb().run("UPDATE alarms SET sent = 1 WHERE id = ?", [id]);
  }

  _msgr
    ?.sendText(chatId, `⏰ ${content}`)
    .catch((err) => console.error("알람 발송 실패:", err));
}

function getDomInTz(unixSec: number, tz: string): number {
  return Number(
    new Date(unixSec * 1000).toLocaleDateString("en-US", { timeZone: tz, day: "numeric" })
  );
}

function nextFireAt(
  scheduledAt: number,
  repeat: RepeatType,
  repeatDom: number | null,
  tz: string
): number {
  switch (repeat) {
    case "daily":
      return scheduledAt + 86400;
    case "weekly":
      return scheduledAt + 7 * 86400;
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
    case "monthly": {
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

      month += 1;
      if (month > 12) {
        month = 1;
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
