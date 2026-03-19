type TmapPlaceInfo = {
  address: string;
};

export async function fetchTmapPlaceInfo(url: string): Promise<TmapPlaceInfo | null> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual" });
    const location = res.headers.get("location") ?? "";

    const contentsParam = new URL(location).searchParams.get("contents");
    if (!contentsParam) return null;

    const decoded = Buffer.from(contentsParam, "base64").toString("utf-8");
    const address = new URLSearchParams(decoded).get("addr");
    if (!address) return null;

    return { address };
  } catch {
    return null;
  }
}
