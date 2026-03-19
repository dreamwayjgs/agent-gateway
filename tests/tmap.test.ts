import { describe, expect, test } from "bun:test";
import { fetchTmapPlaceInfo } from "../src/tools/tmap";

const cases: [string, string][] = [
  ['https://tmap.life/1315848b', '선릉로 605'],
  ['https://tmap.life/9a74e509', '서초구 강남대로 363'],
  ['https://tmap.life/8835a942', '서울 종로구 새문안로5길 11']

];

describe("fetchTmapPlaceInfo", () => {
  test.each(cases)("%s → %s", async (url, expected) => {
    const result = await fetchTmapPlaceInfo(url);
    expect(result).not.toBeNull();
    expect(result?.address).toContain(expected);
  });
});
