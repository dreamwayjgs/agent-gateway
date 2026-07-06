import { describe, expect, test } from "bun:test";
import { isKoreanPlate, processGuroTemplates } from "../src/tools/guro";

describe("isKoreanPlate", () => {
  test.each([
    "100주5827",
    "113소8313",
    "259어4719",
    "53주5427",
    "841러4515",
    "12가3456",
    "123가4567",
    "서울12가3456",
    "경기1가2345",
    "부산99하1234",
  ])("accepts %s", (carNo) => {
    expect(isKoreanPlate(carNo)).toBe(true);
  });

  test.each(["렉스턴", "렉스턴 등록", "", "1가2345", "가1234", "12345678", "ABC1234", "100 주 5827"])("rejects %s", (carNo) => {
    expect(isKoreanPlate(carNo)).toBe(false);
  });
});

test("processGuroTemplates rejects non-plate carNo without API call", async () => {
  const result = await processGuroTemplates("{{주차등록:렉스턴|2026-07-06 09:00:00|2026-07-06 18:00:00}}");

  expect(result).toContain("번호판 형식 아님");
});
