import { test, expect } from "bun:test";
import { validateTimezone } from "../src/config";

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
