#!/usr/bin/env bun
// 사용법: bun scripts/alarms-list.ts <chat_id>
import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const chatId = process.argv[2];
if (!chatId) {
  console.error("usage: bun scripts/alarms-list.ts <chat_id>");
  process.exit(1);
}

const dbPath = resolve(import.meta.dir, "../..", process.env.DB_FILE ?? "data/data.db");
const db = new Database(dbPath, { readonly: true });

type RepeatUnit = "minute" | "hour" | "day" | "week" | "month" | "weekdays";

function repeatLabelKo(row: {
  repeat_unit: RepeatUnit | null;
  repeat_interval: number | null;
  repeat_count: number | null;
  repeat_until: number | null;
}, tz: string): string {
  if (!row.repeat_unit || !row.repeat_interval) return "-";
  const unitLabels: Record<RepeatUnit, string> = {
    minute: "분",
    hour: "시간",
    day: "일",
    week: "주",
    month: "개월",
    weekdays: "주중매일",
  };
  const base = row.repeat_unit === "weekdays"
    ? "주중매일"
    : row.repeat_interval === 1
      ? ({ minute: "매분", hour: "매시간", day: "매일", week: "매주", month: "매월" } as Record<Exclude<RepeatUnit, "weekdays">, string>)[row.repeat_unit]
      : `${row.repeat_interval}${unitLabels[row.repeat_unit]}마다`;
  const count = row.repeat_count != null ? ` ${row.repeat_count}회` : "";
  const until = row.repeat_until != null
    ? ` ~${new Date(row.repeat_until * 1000).toLocaleDateString("ko-KR", { timeZone: tz })}까지`
    : "";
  return `${base}${count}${until}`;
}

const now = Math.floor(Date.now() / 1000);
const rows = db
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
    [string, number]
  >(
    `SELECT id, fire_at, content, repeat_unit, repeat_interval, repeat_count, repeat_until
     FROM alarms
     WHERE chat_id = ? AND sent = 0 AND fire_at > ?
     ORDER BY fire_at ASC`
  )
  .all(chatId, now);

if (rows.length === 0) {
  console.log("예정된 알람이 없습니다.");
} else {
  const tz = process.env.BOT_TIMEZONE ?? "Asia/Seoul";
  for (const r of rows) {
    const timeStr = new Date(r.fire_at * 1000).toLocaleString("ko-KR", {
      timeZone: tz,
      hour12: false,
    });
    const content = r.content.replace(/\t/g, " ").replace(/\r?\n/g, "\\n");
    const repeat = repeatLabelKo(r, tz);
    console.log(`#${r.id}\t${timeStr}\t${repeat}\t${content}`);
  }
}
