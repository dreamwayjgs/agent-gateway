import { test, expect } from "bun:test";
import { resolveIso } from "../src/template";

const TZ = "Asia/Seoul"; // +09:00, DST 없음

test("bare ISO에 +09:00 suffix 추가", () => {
  const result = resolveIso("2026-04-10T18:30:00", TZ);
  expect(result).toBe("2026-04-10T18:30:00+09:00");
  expect(new Date(result).getTime() / 1000).toBe(1775813400); // UTC 09:30
});

test("Z suffix ISO는 그대로 통과", () => {
  const iso = "2026-04-10T09:30:00Z";
  expect(resolveIso(iso, TZ)).toBe(iso);
});

test("±HH:MM offset ISO는 그대로 통과", () => {
  const iso = "2026-04-10T18:30:00+09:00";
  expect(resolveIso(iso, TZ)).toBe(iso);
});

test("±HHMM basic format ISO는 그대로 통과", () => {
  const iso = "2026-04-10T18:30:00+0900";
  expect(resolveIso(iso, TZ)).toBe(iso);
});

test("잘못된 timezone 값은 원본 iso 반환 (isNaN degrade)", () => {
  const iso = "2026-04-10T18:30:00";
  const result = resolveIso(iso, "Asia/Seoull"); // 오타
  expect(result).toBe(iso); // 원본 반환 → new Date(iso) → isNaN 처리로 이어짐
});
