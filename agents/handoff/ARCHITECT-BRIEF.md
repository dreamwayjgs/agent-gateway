# ARCHITECT-BRIEF — 알람 타임존 버그 수정

## 목표

알람이 의도한 시각보다 9시간 늦게 등록되는 버그 수정.
환경변수 `BOT_TIMEZONE`으로 서버 타임존을 명시적으로 관리한다.

## 배경 / 원인

- LLM이 `{{알람:2026-04-10T18:30:00|내용}}` 처럼 TZ 오프셋 없는 bare ISO를 출력할 때가 있음
- 서버(Docker)가 UTC이므로 `new Date("2026-04-10T18:30:00")`이 UTC로 파싱됨
- DB에는 의도한 시각보다 +9시간 된 UTC unix timestamp 저장
- `workspace/AGENTS.md`에 `+09:00` 포함 지시가 있지만 세션 리셋 후 LLM이 빠뜨리는 케이스 발생

## DB 정책 (변경 없음)

`alarms.fire_at`은 항상 UTC unix timestamp. 변경하지 않는다.

## 변경 범위

### 1. `.env.example`

```
# Timezone (IANA: Asia/Seoul, America/New_York 등)
BOT_TIMEZONE=Asia/Seoul
```

### 2. `src/config.ts`

`timezone` 필드를 `process.env.TZ`에서 `BOT_TIMEZONE`으로 변경:

```ts
timezone: process.env.BOT_TIMEZONE ?? "Asia/Seoul",
```

### 3. `src/template.ts` — `extractAlarms()`

bare ISO(Z 또는 `±HH:MM` 없음) 수신 시 BOT_TIMEZONE 오프셋을 붙여 파싱.
`config.timezone`이 `Asia/Seoul`이면 `+09:00` 추가, 일반화는 아래 헬퍼 사용:

```ts
function resolveIso(iso: string, ianaTimezone: string): string {
  if (/Z$|[+-]\d{2}:\d{2}$/.test(iso)) return iso; // 이미 TZ 있음
  const offsetMin = -new Date(
    new Date().toLocaleString("en-US", { timeZone: ianaTimezone })
  ).getTimezoneOffset();  // 부호 주의: getTimezoneOffset()은 반전값
  // 더 단순한 방법: Intl.DateTimeFormat offset 추출
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${iso}${sign}${hh}:${mm}`;
}
```

> **주의**: `getTimezoneOffset()` 방식은 DST 경계에서 부정확할 수 있음.
> `Intl.DateTimeFormat` 기반으로 offset을 구하거나, 단순히 `BOT_TIMEZONE=Asia/Seoul`이면
> `+09:00` 고정 suffix를 붙이는 것도 허용. 단, 함수 시그니처는 유지해서 나중에 교체 가능하게.

### 4. 변경 없는 파일

- `src/alarm.ts` — 변경 없음
- `src/index.ts` — `[현재 시각]` 프롬프트는 이미 `config.timezone` 사용 중, 자동 반영
- DB 스키마 — 변경 없음

## 완료 조건 (Done Criteria)

- [ ] `.env.example`에 `BOT_TIMEZONE=Asia/Seoul` 추가
- [ ] `config.ts`의 timezone 소스가 `BOT_TIMEZONE`
- [ ] `template.ts`에서 bare ISO에 offset 추가 후 파싱
- [ ] `bun test` 통과 (기존 테스트 깨지지 않음)
- [ ] `BOT_TIMEZONE=Asia/Seoul`로 `{{알람:2026-04-10T18:30:00|test}}`가 `2026-04-10 18:30 KST` 기준 UTC로 저장되는지 수동 확인

## 완료 후

`REVIEW-REQUEST.md` 작성 후 리처드에게 넘길 것.
