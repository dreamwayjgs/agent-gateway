type NaverPlaceInfo = {
  placeId: string;
  address: string;
};

export async function fetchNaverPlaceInfo(url: string): Promise<NaverPlaceInfo | null> {
  try {
    // naver.me 단축 URL → 최종 URL 추적
    const res = await fetch(url, { method: "HEAD", redirect: "manual" });
    const location = res.headers.get("location") ?? "";

    const placeMatch = location.match(/\/place\/(\d+)/);
    if (!placeMatch) return null;
    const placeId = placeMatch[1];

    // 주소 API 호출
    const apiRes = await fetch(`https://map.naver.com/p/api/place/address/${placeId}`, {
      headers: {
        "Referer": `https://map.naver.com/p/entry/place/${placeId}?placePath=%2Fhome`,
        "Origin": "https://map.naver.com",
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json, text/plain, */*",
      },
    });

    if (!apiRes.ok) return null;

    const json = await apiRes.json() as { data?: { placeDetail?: { address?: { roadAddress?: string; address?: string } } } };
    const raw = json.data?.placeDetail?.address?.roadAddress
      ?? json.data?.placeDetail?.address?.address;
    if (!raw) return null;

    // 시/도 제거
    const address = raw.replace(/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\s*/, "");

    return { placeId, address };
  } catch {
    return null;
  }
}
