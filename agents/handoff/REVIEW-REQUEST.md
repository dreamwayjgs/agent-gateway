# REVIEW-REQUEST — 알람 목록 조회 스크립트 (재제출)

## 구현 요약

로저 [1][2] + 로먼 [1][2] 피드백 반영.

| 항목 | 내용 |
|------|------|
| 로저 [1] / 로먼 [1] | 모든 workspace 스크립트 DB 경로를 `import.meta.dir` 기준 절대경로로 정규화 — cwd와 무관하게 동작 |
| 로저 [2] / 로먼 [2] | `alarms-list.ts` content TSV 이스케이핑 + `files-list.ts`, `files-search.ts` 출력 필드도 동일 적용 |

## 변경 파일

| 파일 | 내용 |
|------|------|
| `workspace/scripts/alarms-list.ts` | DB 경로 fix, content 이스케이핑 |
| `workspace/scripts/files-list.ts` | DB 경로 fix, 출력 필드 이스케이핑 |
| `workspace/scripts/files-search.ts` | DB 경로 fix, 출력 필드 이스케이핑 |
| `workspace/scripts/files-delete.ts` | DB 경로 fix |
| `workspace/scripts/check-db.ts` | DB 경로 fix |

## 테스트 방법

```bash
bun test   # 13 pass 확인

# DB 경로 수동 확인 (workspace 디렉토리에서 실행해도 올바른 DB 참조)
cd workspace && bun scripts/alarms-list.ts <chat_id>
```

## 리뷰어 주목 포인트

- `resolve(import.meta.dir, "../..", DB_FILE)` — `DB_FILE`이 절대경로면 그대로, 상대경로면 repo root 기준으로 해석 (`node:path`의 `resolve` 동작)
- 이스케이핑: `\t` → 공백, `\r?\n` → 리터럴 `\n` — agent가 한 줄로 읽을 수 있음
