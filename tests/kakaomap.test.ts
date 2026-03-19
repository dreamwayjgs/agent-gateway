import { describe, expect, test } from "bun:test";
import { fetchKakaoPlaceInfo } from "../src/tools/kakaomap";

const cases: [string, string][] = [
  ["https://kko.to/7yR4CsL2bh", "선릉로 605"],
  ['https://place.map.kakao.com/17183821', '원미구 조마루로 2']
];

describe("fetchKakaoPlaceInfo", () => {
  test.each(cases)("%s → %s", async (url, expected) => {
    const result = await fetchKakaoPlaceInfo(url);
    expect(result).not.toBeNull();
    expect(result?.address).toContain(expected);
  });
});
