import { test, expect } from "bun:test";
import { parseMessengers, validateTimezone } from "../src/config";

test("유효한 IANA timezone은 그대로 반환됨", () => {
  expect(validateTimezone("Asia/Seoul")).toBe("Asia/Seoul");
  expect(validateTimezone("America/New_York")).toBe("America/New_York");
  expect(validateTimezone("UTC")).toBe("UTC");
});

test("잘못된 timezone은 에러를 던짐", () => {
  expect(() => validateTimezone("Invalid/Zone")).toThrow('BOT_TIMEZONE 값이 유효하지 않습니다: "Invalid/Zone"');
});

test("빈 문자열 timezone은 에러를 던짐", () => {
  expect(() => validateTimezone("")).toThrow("BOT_TIMEZONE 값이 유효하지 않습니다");
});

test("MESSENGER 값은 단일/콤마/공백 리스트로 파싱됨", () => {
  expect(parseMessengers(undefined)).toEqual(["telegram"]);
  expect(parseMessengers("telegram")).toEqual(["telegram"]);
  expect(parseMessengers("telegram,discord")).toEqual(["telegram", "discord"]);
  expect(parseMessengers(" telegram, discord ,, ")).toEqual(["telegram", "discord"]);
  expect(parseMessengers("")).toEqual([]);
});
