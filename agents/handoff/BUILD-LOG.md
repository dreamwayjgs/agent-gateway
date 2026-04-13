# BUILD-LOG

## 2026-04-13 — 알람 목록 조회 스크립트 (리뷰 피드백 반영)

### 완료 항목

- [x] 모든 workspace 스크립트 DB 경로 — `import.meta.dir` 기준 절대경로 정규화 (cwd 독립)
- [x] `alarms-list.ts` content TSV 이스케이핑 (`\t` → space, `\n` → `\\n`)
- [x] `files-list.ts`, `files-search.ts` 출력 필드 동일 이스케이핑 적용
- [x] `bun test` 13 pass / 0 fail

### 변경 파일

- `workspace/scripts/alarms-list.ts`
- `workspace/scripts/files-list.ts`
- `workspace/scripts/files-search.ts`
- `workspace/scripts/files-delete.ts`
- `workspace/scripts/check-db.ts`

---

## 2026-04-13 — 알람 목록 조회 스크립트

### 완료 항목

- [x] `workspace/scripts/alarms-list.ts` 생성
- [x] 미래 + 미발송 알람 조회 (`sent = 0 AND fire_at > now`)
- [x] 알람 없으면 `예정된 알람이 없습니다.` 출력
- [x] `workspace/AGENTS.md` 알람 섹션에 스크립트 사용법 추가
- [x] `bun test` 13 pass / 0 fail

### 변경 파일

- `workspace/scripts/alarms-list.ts` (신규)
- `workspace/AGENTS.md`

---

## 2026-04-13 — 타임존 버그 수정 (리뷰 피드백 반영)

### 완료 항목

- [x] `resolveIso()` export 후 unit test 5케이스 추가 (`tests/resolveIso.test.ts`)
- [x] DST 한계 주석 추가 (`template.ts`)
- [x] `resolveIso()` RangeError try/catch → 원본 iso 반환으로 degrade
- [x] 정규식에 `±HHMM` basic format 추가 (`/Z$|[+-]\d{2}:\d{2}$|[+-]\d{4}$/`)
- [x] `bun test` 13 pass / 0 fail

### 변경 파일

- `src/template.ts`
- `tests/resolveIso.test.ts` (신규)

---

## 2026-04-10 — 알람 타임존 버그 수정

### 완료 항목

- [x] `.env.example`에 `BOT_TIMEZONE=Asia/Seoul` 추가
- [x] `config.ts` timezone 소스를 `process.env.TZ` → `process.env.BOT_TIMEZONE` 변경
- [x] `template.ts`에 `resolveIso()` 헬퍼 추가, `extractAlarms()`에서 bare ISO에 offset 주입
- [x] `bun test` 8 pass / 0 fail

### 변경 파일

- `.env.example`
- `src/config.ts`
- `src/template.ts`
