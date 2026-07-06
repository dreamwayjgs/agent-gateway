import { config } from "../config";

const DONG = "210";
const HO = "102";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

let sessionCache: { value: string; expiry: number } | null = null;

export async function guroLogin(): Promise<string> {
  const res = await fetch(`${config.guroBaseUrl}/login/doLogin/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      login_id: config.guroId,
      login_pw: config.guroPassword,
      login_ip: "",
      is_ajax: "1",
    }).toString(),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/ci_session=([^;]+)/);
  if (!match) throw new Error("로그인 실패: ci_session 쿠키 없음");
  sessionCache = { value: match[1], expiry: Date.now() + SESSION_TTL_MS };
  return match[1];
}

async function getActiveSession(): Promise<string> {
  if (!sessionCache || Date.now() >= sessionCache.expiry) {
    await guroLogin();
  }
  return sessionCache!.value;
}

async function withSession(call: (cookie: string) => Promise<string>): Promise<string> {
  let session = await getActiveSession();
  let text = await call(`ci_session=${session}`);
  if (text.includes("LoginFail")) {
    sessionCache = null;
    session = await getActiveSession();
    text = await call(`ci_session=${session}`);
  }
  return text;
}

export async function getCredit(): Promise<{ pointServiceable: number; pointPurchase: number }> {
  const text = await withSession(async (cookie) => {
    const res = await fetch(`${config.guroBaseUrl}/index.php/dcTimePurchase/ajax_selDCTimePurchase/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({ is_ajax: "1" }).toString(),
    });
    return res.text();
  });
  return JSON.parse(text);
}

export type VisitCar = {
  carNo: string;
  recordTime: string;
  startdateTime: string;
  enddateTime: string;
  no: number;
};

export async function getVisitCars(from: string, to: string): Promise<VisitCar[]> {
  const text = await withSession(async (cookie) => {
    const res = await fetch(
      `${config.guroBaseUrl}/Visit/Search_VisitInfo?${new URLSearchParams({ SearchfrDate: from, SearchtoDate: to, SearchCarNo: "" })}`,
      { headers: { Cookie: cookie } }
    );
    return res.text();
  });
  const cars: VisitCar[] = [];
  const re = /fnDel\("([^"]+)","([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*(\d+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    cars.push({ carNo: m[1]!, recordTime: m[2]!, startdateTime: m[3]!, enddateTime: m[4]!, no: Number(m[5]) });
  }
  return cars;
}

export async function registerCar(
  carNo: string,
  procDate: string,
  procTime: string,
  endDate: string,
  endTime: string
): Promise<string> {
  const text = await withSession(async (cookie) => {
    const res = await fetch(`${config.guroBaseUrl}/index.php/Visit/ajax_Visit_Ins/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({ carNo, dong: DONG, ho: HO, procDate, procTime, endDate, endTime, is_ajax: "1" }).toString(),
    });
    return res.text();
  });
  if (text.includes("dayCustTrue")) return "등록 실패: 당일 중복 등록";
  if (text.includes("fail")) return "등록 실패";
  if (text.length > 0) return `등록 완료: ${carNo} (${procDate} ${procTime} ~ ${endDate} ${endTime})`;
  return "등록 실패: 빈 응답";
}

export async function deleteCar(
  carNo: string,
  recordTime: string,
  startdateTime: string,
  enddateTime: string,
  no: number = 0
): Promise<string> {
  const text = await withSession(async (cookie) => {
    const res = await fetch(`${config.guroBaseUrl}/Visit/del_VisitInfo`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({ carno: carNo, recordTime, startdateTime, enddateTime, no: String(no), is_ajax: "1" }).toString(),
    });
    return res.text();
  });
  if (text.includes("fail")) return "삭제 실패";
  if (text.length > 0) return `삭제 완료: ${carNo}`;
  return "삭제 실패: 빈 응답";
}

function todayInTz(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: config.timezone });
}

function tomorrowInTz(): string {
  const d = new Date(Date.now() + 86400_000);
  return d.toLocaleDateString("sv-SE", { timeZone: config.timezone });
}

export async function getGuroContext(): Promise<string> {
  const today = todayInTz();
  const tomorrow = tomorrowInTz();
  const [credit, cars] = await Promise.all([
    getCredit().catch(() => null),
    getVisitCars(today, tomorrow).catch(() => [] as VisitCar[]),
  ]);
  const lines = ["[주차 시스템]"];
  if (credit) {
    lines.push(`크레딧: 잔여 ${credit.pointServiceable}분 (총 구매 ${credit.pointPurchase}분)`);
  }
  if (cars.length === 0) {
    lines.push(`방문차량 (${today}~${tomorrow}): 없음`);
  } else {
    lines.push(`방문차량 (${today}~${tomorrow}):`);
    for (const c of cars) {
      lines.push(`  ${c.carNo} | ${c.startdateTime} ~ ${c.enddateTime} | recordTime=${c.recordTime} no=${c.no}`);
    }
  }
  return lines.join("\n");
}

const REGISTER_RE = /\{\{주차등록:([^|}\s]+)\|([^|]+)\|([^}]+)\}\}/g;
const DELETE_RE = /\{\{주차삭제:([^|}\s]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^}]+)\}\}/g;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const PLATE_NEW = /^\d{2,3}[가-힣]\d{4}$/;
const PLATE_OLD = /^[가-힣]{2}\d{1,2}[가-힣]\d{4}$/;

export function isKoreanPlate(carNo: string): boolean {
  return PLATE_NEW.test(carNo) || PLATE_OLD.test(carNo);
}

export async function processGuroTemplates(text: string): Promise<string> {
  const seen = new Map<string, Promise<string>>();

  for (const m of text.matchAll(new RegExp(REGISTER_RE.source, "g"))) {
    const full = m[0]!;
    if (seen.has(full)) continue;
    const carNo = m[1]!.trim();
    const startDt = m[2]!.trim();
    const endDt = m[3]!.trim();
    if (!isKoreanPlate(carNo)) {
      seen.set(full, Promise.resolve(`등록 오류: 번호판 형식 아님 "${carNo}" — 차량목록.md에서 실제 번호로 등록하세요`));
      continue;
    }
    if (!DATETIME_RE.test(startDt) || !DATETIME_RE.test(endDt)) {
      seen.set(full, Promise.resolve(`등록 오류: 날짜 형식 오류 (YYYY-MM-DD HH:MM:SS 필요)`));
      continue;
    }
    const [procDate, procTime] = startDt.split(" ") as [string, string];
    const [endDate, endTime] = endDt.split(" ") as [string, string];
    seen.set(
      full,
      registerCar(carNo, procDate, procTime, endDate, endTime).catch(
        (e) => `등록 오류: ${e instanceof Error ? e.message : String(e)}`
      )
    );
  }

  for (const m of text.matchAll(new RegExp(DELETE_RE.source, "g"))) {
    const full = m[0]!;
    if (seen.has(full)) continue;
    const carNo = m[1]!.trim();
    const recordTime = m[2]!.trim();
    const startdateTime = m[3]!.trim();
    const enddateTime = m[4]!.trim();
    const no = Number(m[5]!.trim());
    if (!isKoreanPlate(carNo)) {
      seen.set(full, Promise.resolve(`삭제 오류: 번호판 형식 아님 "${carNo}" — 차량목록.md에서 실제 번호로 등록하세요`));
      continue;
    }
    if (!Number.isInteger(no) || no < 0) {
      seen.set(full, Promise.resolve(`삭제 오류: no 값 형식 오류 (0 이상 정수 필요)`));
      continue;
    }
    seen.set(
      full,
      deleteCar(carNo, recordTime, startdateTime, enddateTime, no).catch(
        (e) => `삭제 오류: ${e instanceof Error ? e.message : String(e)}`
      )
    );
  }

  if (seen.size === 0) return text;

  const entries = [...seen.entries()];
  const resolved = await Promise.all(entries.map(([, p]) => p));
  let result = text;
  for (const [i, [full]] of entries.entries()) {
    result = result.split(full).join(resolved[i] ?? "");
  }
  return result;
}
