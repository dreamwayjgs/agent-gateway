# REVIEW-FEEDBACK — 알람 목록 조회 스크립트

## First Review (리처드)

**결과: Approved**

---

### Done Criteria 체크

| 항목 | 상태 |
|------|------|
| `workspace/scripts/alarms-list.ts` 생성 | ✅ |
| `bun scripts/alarms-list.ts <chat_id>` 실행 시 미래 알람 목록 출력 | ✅ |
| 알람 없으면 `예정된 알람이 없습니다.` 출력 | ✅ |
| `workspace/AGENTS.md` 알람 섹션에 스크립트 사용법 추가 | ✅ |

---

### 검토 결과

**패턴 준수** — `files-list.ts`와 구조 동일. readonly DB, chat_id 검증, 파라미터화 쿼리 일관 적용. ✅

**보안** — `Number(chatId)`로 변환 후 parameterized query에 바인딩. SQL injection 없음. ✅

**Bun 패턴** — `bun:sqlite` 사용, `readonly: true` 명시. 금지 패키지 없음. ✅

**엣지 케이스 처리**
- 빈 결과 → `예정된 알람이 없습니다.` ✅
- `isNaN` 판정 없이 `Number(chatId) = NaN`이 되어도 `WHERE chat_id = NaN` 쿼리가 결과 없이 빈 rows 반환 → 에이전트가 "알람 없음"으로 읽음. 오동작 없음. ✅
- `fire_at > now` 조건으로 과거 알람 제외 ✅

---

### 노트 (블로킹 아님)

**N1. `BOT_TIMEZONE` RangeError** — `alarms-list.ts:32`

잘못된 IANA 값이 들어오면 `toLocaleString`에서 `RangeError`가 발생한다. 이전 타임존 버그 수정 PR에서 `config.ts` 유효성 검증이 추가되더라도, 이 스크립트는 `config.ts`를 import하지 않고 `process.env.BOT_TIMEZONE`을 직접 읽으므로 해당 보호를 받지 못한다.

단, 독립 실행 스크립트이고 에러 발생 시 봇 전체에 영향 없으며, 동일한 `BOT_TIMEZONE` 값은 봇 기동 시 이미 검증된 상태일 것이므로 블로킹하지 않는다.

**N2. 알람 삭제 스크립트 없음** — 이번 스코프 밖

`files-delete.ts` 대응 스크립트(`alarms-delete.ts`)가 없다. 현재 에이전트가 알람을 취소할 수 없다. 별도 이슈로 추적 권장.

---

다음 리뷰어: **로저 (2차)**

## First Review 재검토 (리처드, 2026-04-13)

**결과: Approved**

### 로저·로먼 지적 사항 반영 확인

**[1] DB 경로 문제** (`alarms-list.ts:12`) — **해소됨** ✅

`resolve(import.meta.dir, "../..", process.env.DB_FILE ?? "data/data.db")` 패턴으로
cwd 독립적인 절대경로 해석 적용. `DB_FILE`이 절대경로이면 `resolve`가 앞 인자를 무시하므로
Docker 운영 환경(`/app/data/data.db`)도 정상 동작. `files-list`, `files-delete`,
`files-search`, `check-db` 등 기존 스크립트 5개도 동일 패턴으로 일관 적용됨.

**[2] TSV content escaping** (`alarms-list.ts:37`) — **해소됨** ✅

탭 → 공백, 개행 → `\n` 리터럴로 치환. `files-list.ts`, `files-search.ts`에도 동일한
`esc()` 함수로 적용되어 포맷 일관성 유지.

### 기존 노트 상태

- **N1** `BOT_TIMEZONE` RangeError — 여전히 미처리이나 블로킹 아님으로 판단 유지
- **N2** 알람 삭제 스크립트 — 스코프 밖, 별도 이슈로 추적

---

## Second Review (로저)

**결과: Changes Requested**

---

### 지적 사항

#### [1] Agent 실행 컨텍스트에서 기본/환경변수 DB 경로가 깨져 스크립트가 바로 실패함 — `workspace/scripts/alarms-list.ts:11-12`

**severity: Changes Requested**

이 스크립트는 agent가 `workspace`를 cwd로 실행하는 컨텍스트에서 쓰이는데, backend subprocess는 실제로 `cwd = ./workspace`로 올라간다. `src/agent/codex.ts:20-23`

그 상태에서 `DB_FILE`을 그대로 넘기면 상대경로가 `workspace` 기준으로 재해석된다.
- 앱 기본값: `src/db.ts:92` → `./data/data.db`
- 스크립트 기본값: `workspace/scripts/alarms-list.ts:11` → `../data.db`

둘 다 현재 앱이 쓰는 DB와 일치하지 않을 수 있고, 실제로 `workdir=workspace`에서 `DB_FILE=./data/data.db bun scripts/alarms-list.ts 1` 및 `DB_FILE=./data.db ...`를 재현해 보면 둘 다 `SQLITE_CANTOPEN`으로 실패한다.

즉, REVIEW-REQUEST에 적힌 수동 명령은 repo root에서는 동작할 수 있어도, agent가 `workspace/AGENTS.md` 지침대로 `bun scripts/alarms-list.ts <chat_id>`를 실행하는 실제 운영 경로에서는 실패한다. 스크립트 내부에서 repo root 기준 절대/정규화 경로로 맞추거나, 최소한 봇/스크립트가 동일한 DB path 해석 규칙을 공유해야 한다.

---

#### [2] 알람 내용을 TSV로 그대로 출력해 탭/개행 포함 시 목록 포맷이 깨짐 — `workspace/scripts/alarms-list.ts:36`

**severity: Changes Requested**

`workspace/AGENTS.md`는 출력 형식을 `#id\t시각(KST)\t내용`으로 고정해 두었는데, 스크립트는 `content`를 escaping 없이 그대로 출력한다.

그런데 실제 알람 내용은 `src/template.ts:37-43` 경로에서 raw text로 저장되며, 정규식상 개행과 탭이 모두 허용된다. 예를 들어 `{{알람:...|회의\n준비\t체크}}` 같은 입력은 그대로 DB에 들어간다.

이 경우 목록 한 건이 여러 줄로 쪼개지거나 컬럼 경계가 무너져 agent가 결과를 잘못 읽을 수 있다. 최소한 `\t`, `\n`, `\r`를 이스케이프하거나, 기계 소비용이라면 TSV 대신 JSON Lines 같은 포맷으로 바꾸는 편이 안전하다.

---

### 메모

리처드가 남긴 `BOT_TIMEZONE` note와 알람 삭제 스크립트 부재는 중복하지 않았다. 이번 diff에서 새로 추가된 알람 목록 기능은 위 두 건이 해소되기 전까지는 운영 경로에서 신뢰하기 어렵다.

## Second Review (로저) — Re-review (2026-04-13)

**결과: Approved**

### 반영 확인

- `workspace/scripts/alarms-list.ts:12-13`에서 `resolve(import.meta.dir, "../..", ...)`로 DB 경로를 정규화해 `workspace` cwd에서도 봇과 동일한 DB를 참조한다. `DB_FILE=./data/data.db`로 `cd workspace && bun scripts/alarms-list.ts 1` 재실행 시 `SQLITE_CANTOPEN` 없이 동작 확인.
- 같은 DB 경로 정규화가 `workspace/scripts/files-list.ts:12-13`, `workspace/scripts/files-search.ts:14-15`, `workspace/scripts/files-delete.ts:13-14`, `workspace/scripts/check-db.ts:3-4`에도 일관 적용됐다.
- `workspace/scripts/alarms-list.ts:37-38`에서 알람 내용을 `\t -> 공백`, 개행 -> 리터럴 `\n`으로 치환해 한 줄 TSV 포맷이 유지된다.
- 동일한 escaping이 `workspace/scripts/files-list.ts:31-35`, `workspace/scripts/files-search.ts:35-39`에도 들어가 기존 목록/검색 출력 포맷과 일관성이 맞춰졌다.

로저가 제기했던 운영 경로 DB 참조 문제와 TSV 포맷 파손 문제는 모두 해소됐다. 로먼이 활성 리뷰어면 그쪽 기준으로만 추가 재검토하면 된다.

## Third Review (로먼)

**결과: Changes Requested**

---

### 통합/운영 관점 지적 사항

#### [1] 스크립트 실행 경로(cwd)와 DB 파일 참조 일관성 — `workspace/scripts/alarms-list.ts:11`
**severity: Changes Requested**

로저가 지적한 실행 컨텍스트 경로 문제에 동의합니다. 추가로, 이 문제는 신규 스크립트인 `alarms-list.ts`뿐만 아니라 **기존의 `files-list.ts`, `files-delete.ts`, `files-search.ts` 등 모든 workspace 스크립트에도 공통적으로 존재하는 잠재적 장애 포인트**입니다.
에이전트는 `cwd=./workspace`로 실행되는데, 스크립트 내부에서 `process.env.DB_FILE ?? "../data.db"`로 처리하면 `DB_FILE`이 상대 경로(`./data/data.db`)로 넘어올 경우 `workspace/data/data.db`를 찾게 되어 SQLite가 작동하지 않거나 빈 DB를 생성해버립니다. (Docker에서는 절대 경로 `/app/data/data.db`를 쓰기 때문에 운 좋게 통과되지만 로컬 개발 환경에서 깨집니다).
Node/Bun의 `path.resolve`를 사용해 프로젝트 루트 기준으로 `DB_FILE`의 경로를 정규화하는 유틸리티 함수를 만들거나 절대 경로를 강제하는 방어 로직을 모든 스크립트에 일관되게 적용해야 합니다.

#### [2] 에이전트 파싱용 출력 포맷(TSV) 취약점 — `workspace/scripts/alarms-list.ts:36`
**severity: Changes Requested**

마찬가지로 로저의 TSV 이스케이핑 지적에 동의합니다. 사용자 입력(content, memo 등)에 개행(`\n`)이나 탭(`\t`)이 포함될 수 있는 구조이므로, TSV 포맷을 유지하려면 반드시 스크립트 단에서 이스케이프 처리(예: `content.replace(/\n/g, "\\n").replace(/\t/g, " ")`)를 해야 합니다.
만약 에이전트가 JSON Lines를 더 잘 파싱한다면, 모든 스크립트의 출력 포맷을 JSON Lines로 전환하는 방안도 고려해볼 만합니다. (이 경우 `AGENTS.md`의 스크립트 출력 설명도 함께 수정해야 합니다).

---

### 승인 조건

1. `alarms-list.ts` 포함 모든 workspace 스크립트에서 `DB_FILE` 경로 해석 시 cwd 독립적인 처리(절대경로 변환 등) 적용
2. `alarms-list.ts` 출력 시 `r.content`에 포함된 개행/탭 문자를 이스케이프 또는 치환 처리 (기존 스크립트도 함께 적용 권장)

## Third Review (로먼) — Re-review (2026-04-13)

**결과: Changes Requested**

워크스페이스 스크립트의 경로 문제와 출력 포맷 문제는 완벽하게 해결되었으나, 이전 리뷰(타임존 수정 건 등)에서 승인 조건으로 제시했던 **시스템 연동 안정성** 관련 사항들이 이번 재제출에서 누락되었습니다.

### 1. 타임존 및 워크스페이스 스크립트 (반영 확인)

#### [1-1] DB 경로 정규화 — `workspace/scripts/*.ts`
**상태: Approved ✅**
`resolve(import.meta.dir, "../..", ...)` 패턴을 사용하여 실행 경로(cwd)에 상관없이 프로젝트 루트 기준의 DB 파일을 안정적으로 참조하도록 수정되었습니다. 모든 관련 스크립트(5종)에 일관되게 적용된 점을 높게 평가합니다.

#### [1-2] TSV 출력 이스케이핑 — `workspace/scripts/*.ts`
**상태: Approved ✅**
`r.content`, `r.memo` 등 사용자 입력값이 포함되는 모든 필드에 대해 탭을 공백으로, 개행을 `\n` 리터럴로 치환하는 로직이 추가되었습니다. 이로써 에이전트가 목록을 파싱할 때 행이 쪼개지거나 컬럼이 밀리는 문제를 방지할 수 있게 되었습니다.

### 2. 이전 리뷰 누락 사항 (재요청)

아래 사항들은 이번 재제출 범위(`alarms-list.ts`)에 직접 포함되지 않았더라도, 전체 시스템의 안정성을 위해 이전 리뷰에서 **승인 조건**으로 명시했던 사항들입니다. 다음 반영 시 함께 수정되어야 합니다.

#### [2-1] 스트리밍 JSON 파싱 버퍼링 미구현 — `src/agent/*.ts`
**severity: Critical / Changes Requested**
`gemini.ts`, `codex.ts`, `vibe.ts` 모두 여전히 `chunk.toString().split("\n")`을 사용하고 있습니다. 스트림 데이터가 개행 중간에서 끊겨 들어올 경우 JSON 파싱 에러와 함께 데이터가 유실됩니다. 누적 버퍼를 사용하여 완결된 라인만 처리하는 로직으로 반드시 전환해야 합니다.

#### [2-2] `config.ts` 내 타임존 유효성 검증 부재
**severity: Critical / Changes Requested**
`BOT_TIMEZONE` 오타 시 봇 전체가 크래시나는 현상을 방지하기 위해 `config.ts` 초기화 시점에 IANA 타임존 유효성을 체크하는 로직이 여전히 누락되어 있습니다.

#### [2-3] `GEMINI.md` 가이드라인 최신화
**severity: Note**
`sessions.json` 등 구버전 사양에 대한 가이드라인 수정이 아직 반영되지 않았습니다.

---

### 승인 조건 (최종)

1. **(에이전트 공통)** 모든 에이전트의 `stdout` 파싱 로직에 **개행 기준 누적 버퍼(Stream Buffering)** 적용
2. **(설정)** `src/config.ts`에 `BOT_TIMEZONE` 유효성 검증 로직 추가
3. **(문서)** `GEMINI.md` 내 운영 관점 가이드라인을 SQLite 사양에 맞게 최신화
