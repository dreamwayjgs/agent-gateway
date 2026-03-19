import { describe, expect, test } from "bun:test";
import { fetchNaverPlaceInfo } from "../src/tools/navermap";

const cases: [string, string][] = [
  ["https://naver.me/IGJlaWy5", "강남구 논현로167길 16"],
  ["https://naver.me/x0U3vxAn", "강남구 선릉로111길 23"],
  ["https://naver.me/FJIz8ce4", "관저서로 20"]
];

describe("fetchNaverPlaceInfo", () => {
  test.each(cases)("%s → %s", async (url, expected) => {
    const result = await fetchNaverPlaceInfo(url);
    expect(result).not.toBeNull();
    expect(result?.address).toContain(expected);
  });
});
