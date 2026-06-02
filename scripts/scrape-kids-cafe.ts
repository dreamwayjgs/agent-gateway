import { Database } from "bun:sqlite";

const BASE_URL = "https://umppa.seoul.go.kr/icare/user/kidsCafe/BD_selectKidsCafeList.do";
const DB_PATH = "data/kids_cafe.db";
const STLES = [2001, 2002] as const;

interface CafeRow {
  fclty_id: string;
  stle: number;
  name: string;
  address: string | null;
  phone: string | null;
  age_range: string | null;
  capacity: string | null;
  is_active: number;
  first_seen: string;
  last_seen: string;
}

interface ScrapedCafe {
  fclty_id: string;
  stle: number;
  name: string;
  address: string | null;
  phone: string | null;
  age_range: string | null;
  capacity: string | null;
}

function nowKST(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(" ", "T");
}

function initDB(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS kids_cafe (
      fclty_id    TEXT NOT NULL,
      stle        INTEGER NOT NULL,
      name        TEXT NOT NULL,
      address     TEXT,
      phone       TEXT,
      age_range   TEXT,
      capacity    TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1,
      first_seen  TEXT NOT NULL,
      last_seen   TEXT NOT NULL,
      PRIMARY KEY (fclty_id, stle)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS kids_cafe_changes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      fclty_id    TEXT NOT NULL,
      stle        INTEGER NOT NULL,
      changed_at  TEXT NOT NULL,
      change_type TEXT NOT NULL,
      old_value   TEXT,
      new_value   TEXT
    )
  `);
}

async function fetchPage(stle: number, page: number): Promise<string> {
  const params = new URLSearchParams({
    q_hiddenVal: "1",
    q_fcltyId: "",
    q_rowPerPage: "5",
    q_currPage: String(page),
    q_sortName: "",
    q_sortOrder: "",
    q_fcltyStle: String(stle),
    q_searchVal: "",
    q_useAge: "",
  });
  const res = await fetch(`${BASE_URL}?${params}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; scraper/1.0)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function detectMaxPage(html: string): number {
  const matches = [...html.matchAll(/jsMovePage\((\d+)\)/g)];
  if (matches.length === 0) return 1;
  return Math.max(...matches.map((m) => parseInt(m[1], 10)));
}

interface ParseResult {
  cafes: ScrapedCafe[];
  parseFailures: number;
}

function parseCafes(html: string, stle: number): ParseResult {
  const cafes: ScrapedCafe[] = [];
  let parseFailures = 0;

  const blocks = splitByH5(html);

  for (const block of blocks) {
    try {
      const cafe = parseBlock(block, stle);
      if (cafe) {
        cafes.push(cafe);
      } else {
        // block found but name/id missing — HTML structure changed
        console.error(`[경고] 파싱 실패 블록 skip (name/id 없음)`);
        parseFailures++;
      }
    } catch (e) {
      console.error(`[경고] 파싱 실패 블록 skip: ${e}`);
      parseFailures++;
    }
  }

  return { cafes, parseFailures };
}

function splitByH5(html: string): string[] {
  // Split HTML at each <h5> occurrence
  const parts = html.split(/<h5[^>]*>/);
  return parts.slice(1).map((p, i) => `<h5>${p}`);
}

function parseBlock(block: string, stle: number): ScrapedCafe | null {
  // name from <h5>
  const nameMatch = block.match(/<h5[^>]*>([\s\S]*?)<\/h5>/);
  if (!nameMatch) return null;
  const name = nameMatch[1].replace(/<[^>]+>/g, "").trim();
  if (!name) return null;

  // fclty_id from link
  const idMatch = block.match(/BD_selectKidsCafeView\.do\?q_fcltyId=([A-Z0-9]+)/);
  if (!idMatch) return null;
  const fclty_id = idMatch[1];

  // address label has non-breaking spaces: 주&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;소
  const address = extractDtDd(block, "주(?:&nbsp;|\\s)*소");

  // phone: from tel: link or dd after 전화번호
  const phoneBlock = extractDtDdRaw(block, "전화번호");
  let phone: string | null = null;
  if (phoneBlock) {
    const telMatch = phoneBlock.match(/href="tel:([^"]+)"/);
    phone = telMatch ? telMatch[1].trim() : phoneBlock.replace(/<[^>]+>/g, "").trim() || null;
  }

  // age_range: <dt class="age">이용연령</dt> <dd ...><strong>...</strong>
  const ageBlock = extractDtDdRaw(block, "이용연령");
  let age_range: string | null = null;
  if (ageBlock) {
    const strongMatch = ageBlock.match(/<strong[^>]*>([\s\S]*?)<\/strong>/);
    age_range = strongMatch
      ? strongMatch[1].replace(/<[^>]+>/g, "").trim() || null
      : ageBlock.replace(/<[^>]+>/g, "").trim() || null;
  }

  // capacity: <strong>개인</strong><span>N 명</span>
  const capBlock = extractDtDdRaw(block, "이용정원");
  let capacity: string | null = null;
  if (capBlock) {
    const capMatch = capBlock.match(/<strong[^>]*>개인<\/strong>\s*<span[^>]*>([\s\S]*?)<\/span>/);
    if (capMatch) {
      capacity = capMatch[1].replace(/<[^>]+>/g, "").trim() || null;
    } else {
      const spanMatch = capBlock.match(/<span[^>]*>([\s\S]*?)<\/span>/);
      capacity = spanMatch ? spanMatch[1].replace(/<[^>]+>/g, "").trim() || null : null;
    }
  }

  return { fclty_id, stle, name, address, phone, age_range, capacity };
}

function extractDtDdRaw(html: string, label: string): string | null {
  // Match <dt ...>label</dt> then next <dd ...>content</dd>
  const re = new RegExp(
    `<dt[^>]*>\\s*${label}\\s*<\\/dt>\\s*<dd[^>]*>([\\s\\S]*?)<\\/dd>`,
    "i"
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

function extractDtDd(html: string, label: string): string | null {
  const raw = extractDtDdRaw(html, label);
  if (!raw) return null;
  const text = raw.replace(/<[^>]+>/g, "").trim();
  return text || null;
}

interface ScrapeResult {
  cafes: ScrapedCafe[];
  hasFailures: boolean;
}

async function scrapeAll(): Promise<ScrapeResult> {
  const all: ScrapedCafe[] = [];
  let hasFailures = false;

  for (const stle of STLES) {
    let maxPage = 1;
    let page = 1;

    while (page <= maxPage) {
      try {
        const html = await fetchPage(stle, page);
        if (page === 1) {
          maxPage = detectMaxPage(html);
        }
        const { cafes, parseFailures } = parseCafes(html, stle);
        console.log(`[스크랩] stle=${stle} page ${page}/${maxPage} ... ${cafes.length}개`);
        all.push(...cafes);
        if (parseFailures > 0) hasFailures = true;
      } catch (e) {
        console.error(`[경고] stle=${stle} page=${page} 실패: ${e}`);
        hasFailures = true;
      }
      page++;
    }
  }

  return { cafes: all, hasFailures };
}

function applyChanges(db: Database, scraped: ScrapedCafe[], dryRun: boolean, hasFailures: boolean = false): void {
  const now = nowKST();

  const existingRows = db.query<CafeRow, []>(
    "SELECT * FROM kids_cafe"
  ).all();

  const existingMap = new Map<string, CafeRow>();
  for (const row of existingRows) {
    existingMap.set(`${row.fclty_id}:${row.stle}`, row);
  }

  const scrapedKeys = new Set(scraped.map((c) => `${c.fclty_id}:${c.stle}`));

  let newCount = 0;
  let inactiveCount = 0;
  let changedCount = 0;

  if (!dryRun) {
    const insert = db.prepare(`
      INSERT INTO kids_cafe (fclty_id, stle, name, address, phone, age_range, capacity, is_active, first_seen, last_seen)
      VALUES ($fclty_id, $stle, $name, $address, $phone, $age_range, $capacity, 1, $now, $now)
    `);
    const update = db.prepare(`
      UPDATE kids_cafe SET name=$name, address=$address, phone=$phone, age_range=$age_range,
        capacity=$capacity, is_active=1, last_seen=$now
      WHERE fclty_id=$fclty_id AND stle=$stle
    `);
    const setInactive = db.prepare(`
      UPDATE kids_cafe SET is_active=0, last_seen=$now WHERE fclty_id=$fclty_id AND stle=$stle
    `);
    const insertChange = db.prepare(`
      INSERT INTO kids_cafe_changes (fclty_id, stle, changed_at, change_type, old_value, new_value)
      VALUES ($fclty_id, $stle, $changed_at, $change_type, $old_value, $new_value)
    `);

    // Upsert scraped
    for (const cafe of scraped) {
      const key = `${cafe.fclty_id}:${cafe.stle}`;
      const existing = existingMap.get(key);

      if (!existing) {
        insert.run({
          $fclty_id: cafe.fclty_id,
          $stle: cafe.stle,
          $name: cafe.name,
          $address: cafe.address,
          $phone: cafe.phone,
          $age_range: cafe.age_range,
          $capacity: cafe.capacity,
          $now: now,
        });
        insertChange.run({
          $fclty_id: cafe.fclty_id,
          $stle: cafe.stle,
          $changed_at: now,
          $change_type: "new",
          $old_value: null,
          $new_value: cafe.name,
        });
        console.log(`[신규] ${cafe.name} (ID: ${cafe.fclty_id})`);
        newCount++;
      } else {
        update.run({
          $fclty_id: cafe.fclty_id,
          $stle: cafe.stle,
          $name: cafe.name,
          $address: cafe.address,
          $phone: cafe.phone,
          $age_range: cafe.age_range,
          $capacity: cafe.capacity,
          $now: now,
        });

        // Re-activation
        if (existing.is_active === 0) {
          insertChange.run({
            $fclty_id: cafe.fclty_id,
            $stle: cafe.stle,
            $changed_at: now,
            $change_type: "reactivated",
            $old_value: null,
            $new_value: cafe.name,
          });
          console.log(`[재개장] ${cafe.name} (ID: ${cafe.fclty_id})`);
          newCount++;
        }

        // Field diffs
        for (const field of ["name", "address", "phone", "age_range", "capacity"] as const) {
          const oldVal = existing[field];
          const newVal = cafe[field];
          if (oldVal !== newVal) {
            insertChange.run({
              $fclty_id: cafe.fclty_id,
              $stle: cafe.stle,
              $changed_at: now,
              $change_type: field,
              $old_value: oldVal,
              $new_value: newVal,
            });
            console.log(`[변경] ${cafe.name} — ${field} 변경`);
            changedCount++;
          }
        }
      }
    }

    // Inactive: was active but not in scraped
    if (hasFailures) {
      console.error("[경고] 페이지 수집 실패 있음 — inactive 감지 건너뜀 (오기록 방지)");
    } else {
      for (const [key, row] of existingMap) {
        if (row.is_active === 1 && !scrapedKeys.has(key)) {
          setInactive.run({ $fclty_id: row.fclty_id, $stle: row.stle, $now: now });
          insertChange.run({
            $fclty_id: row.fclty_id,
            $stle: row.stle,
            $changed_at: now,
            $change_type: "inactive",
            $old_value: row.name,
            $new_value: null,
          });
          console.log(`[비활성] ${row.name} (폐점 감지)`);
          inactiveCount++;
        }
      }
    }
  } else {
    // dry-run: just compute counts
    for (const cafe of scraped) {
      const key = `${cafe.fclty_id}:${cafe.stle}`;
      const existing = existingMap.get(key);
      if (!existing) {
        newCount++;
      } else {
        if (existing.is_active === 0) newCount++;
        for (const field of ["name", "address", "phone", "age_range", "capacity"] as const) {
          if (existing[field] !== cafe[field]) changedCount++;
        }
      }
    }
    if (!hasFailures) {
      for (const [key, row] of existingMap) {
        if (row.is_active === 1 && !scrapedKeys.has(key)) inactiveCount++;
      }
    } else {
      console.error("[경고] 페이지 수집 실패 있음 — inactive 감지 건너뜀 (오기록 방지)");
    }
  }

  const parts: string[] = [];
  if (newCount === 0 && inactiveCount === 0 && changedCount === 0) {
    parts.push("변경 없음");
  } else {
    if (newCount > 0) parts.push(`신규 ${newCount}건`);
    if (inactiveCount > 0) parts.push(`비활성 ${inactiveCount}건`);
    if (changedCount > 0) parts.push(`변경 ${changedCount}건`);
  }

  const suffix = dryRun ? " (dry-run, DB 미저장)" : " 저장 완료";
  console.log(`[저장] ${parts.join(" / ")}${suffix}`);
}

function printList(db: Database): void {
  const rows = db.query<CafeRow, []>(
    "SELECT * FROM kids_cafe WHERE is_active=1 ORDER BY stle, name"
  ).all();

  if (rows.length === 0) {
    console.log("저장된 활성 항목 없음");
    return;
  }

  console.log(
    ["fclty_id", "stle", "name", "address", "phone", "age_range", "capacity"]
      .join("\t")
  );
  for (const r of rows) {
    console.log(
      [r.fclty_id, r.stle, r.name, r.address ?? "", r.phone ?? "", r.age_range ?? "", r.capacity ?? ""]
        .join("\t")
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const listMode = args.includes("--list");

  if (listMode) {
    const db = new Database(DB_PATH);
    initDB(db);
    printList(db);
    db.close();
    return;
  }

  const db = dryRun ? new Database(":memory:") : new Database(DB_PATH);
  initDB(db);

  // For dry-run with :memory: we still want to compare against real DB if exists
  let compareDB: Database | null = null;
  if (dryRun) {
    try {
      compareDB = new Database(DB_PATH, { readonly: true });
    } catch {
      // DB doesn't exist yet — fine
    }
  }

  const { cafes: scraped, hasFailures } = await scrapeAll();
  console.log(`[완료] 총 ${scraped.length}개 수집`);

  if (dryRun) {
    console.log("\n[dry-run 파싱 결과]");
    for (const c of scraped) {
      console.log(
        `  stle=${c.stle} ${c.fclty_id} ${c.name} | ${c.address ?? "-"} | ${c.phone ?? "-"}`
      );
    }

    // Compare against real DB for change preview
    const targetDB = compareDB ?? db;
    applyChanges(targetDB, scraped, true, hasFailures);
    compareDB?.close();
  } else {
    applyChanges(db, scraped, false, hasFailures);
    db.close();
  }
}

main().catch((e) => {
  console.error(`[오류] ${e}`);
  process.exit(1);
});
