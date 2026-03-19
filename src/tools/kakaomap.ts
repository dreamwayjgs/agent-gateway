type KakaoPlaceInfo = {
  address: string;
};

export async function fetchKakaoPlaceInfo(url: string): Promise<KakaoPlaceInfo | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;

    const html = await res.text();
    const address =
      html.match(/<meta\s[^>]*property="og:description"[^>]*content="([^"]+)"/)?.[1] ??
      html.match(/<meta\s[^>]*content="([^"]+)"[^>]*property="og:description"/)?.[1];

    if (!address) return null;
    return { address };
  } catch {
    return null;
  }
}
