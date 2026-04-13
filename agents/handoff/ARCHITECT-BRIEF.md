# ARCHITECT-BRIEF — 알람 목록 조회 스크립트

## 목표

에이전트가 현재 채팅방의 예정 알람 목록을 조회할 수 있도록 스크립트를 추가한다.

## 배경

- 현재 에이전트는 알람을 등록할 수 있지만, 등록된 목록을 볼 수 없음
- 파일 조회(`bun scripts/files-list.ts <chat_id>`)와 동일한 패턴으로 구현

## 변경 범위

### 1. `workspace/scripts/alarms-list.ts` (신규)

`files-list.ts`와 동일한 패턴:

- 인자: `<chat_id>`
- DB: `process.env.DB_FILE ?? "../data.db"`, readonly
- 조회 조건: `chat_id = ? AND sent = 0 AND fire_at > now` (미발송 + 미래 알람만)
- 출력 형식: `#id\t시각(KST)\t내용` — 탭 구분, `fire_at` 오름차순
- 시각 표시: `new Date(r.fire_at * 1000).toLocaleString("ko-KR", { timeZone: process.env.BOT_TIMEZONE ?? "Asia/Seoul", hour12: false })`
- 결과 없으면: `예정된 알람이 없습니다.`

### 2. `workspace/AGENTS.md` — 알람 섹션에 추가

기존 알람 섹션 하단에 아래 내용 추가:

```
### 알람 목록 조회

bun scripts/alarms-list.ts <chat_id>

출력 형식: #id\t시각(KST)\t내용
```

## 완료 조건 (Done Criteria)

- [ ] `workspace/scripts/alarms-list.ts` 생성
- [ ] `bun scripts/alarms-list.ts <chat_id>` 실행 시 미래 알람 목록 출력
- [ ] 알람 없으면 `예정된 알람이 없습니다.` 출력
- [ ] `workspace/AGENTS.md` 알람 섹션에 스크립트 사용법 추가

## 완료 후

`REVIEW-REQUEST.md` 작성 후 리처드에게 넘길 것.
