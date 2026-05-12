# ARCHITECT-BRIEF — stdout 버퍼링 + BOT_TIMEZONE 검증

## 목표

에이전트 응답이 길 때 간헐적으로 발생하는 JSON 파싱 유실을 막는다.
부수적으로 BOT_TIMEZONE 잘못된 값이 주입됐을 때 시작 시점에 명확한 오류를 낸다.

---

## 배경 & 원인

`codex.ts`, `gemini.ts`, `vibe.ts` 모두 `proc.stdout.on("data")` 에서
`chunk.toString().split("\n")` 으로 라인을 분리한다.

Node.js `data` 이벤트는 청크 경계를 보장하지 않는다.
한 청크의 끝이 NDJSON 라인 중간에서 잘릴 수 있고,
이 경우 `JSON.parse` 가 실패하면 `continue` 로 조용히 버려진다.
다음 청크에 나머지가 오더라도 이미 버린 뒤라 복구 불가.

---

## 변경 범위

| 파일 | 변경 내용 |
|------|-----------|
| `src/agent/codex.ts` | stdout 라인 버퍼 적용 |
| `src/agent/gemini.ts` | stdout 라인 버퍼 적용 |
| `src/agent/vibe.ts` | stdout 라인 버퍼 적용 |
| `src/config.ts` | BOT_TIMEZONE 유효성 검증 추가 |

---

## 구현 명세

### 1. stdout 라인 버퍼 (세 파일 공통 패턴)

각 파일에서 `proc.stdout.on("data", ...)` 핸들러를 아래 패턴으로 교체한다.

```ts
let buf = "";

proc.stdout.on("data", (chunk: Buffer) => {
  buf += chunk.toString();
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";          // 마지막 불완전 라인은 보류
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      continue;
    }
    // ... 기존 msg 처리 로직 그대로
  }
});
```

`proc.on("close", ...)` 에서 `buf` 잔여분도 처리한다.

```ts
proc.on("close", (code) => {
  // 잔여 버퍼 처리
  if (buf.trim()) {
    try {
      const msg = JSON.parse(buf.trim()) as Record<string, unknown>;
      // ... 기존 msg 처리 로직 그대로
    } catch { /* 불완전 청크이면 무시 */ }
  }
  clearTimeout(timer);
  // ... 기존 close 처리 로직
});
```

각 파일의 기존 msg 처리 로직(threadId/response 추출 등)은 그대로 유지한다.

### 2. BOT_TIMEZONE 유효성 검증 (`src/config.ts`)

`timezone` 값을 읽은 직후 IANA 유효성을 검사한다.
`Intl.DateTimeFormat` 은 잘못된 timeZone 문자열에 `RangeError` 를 던진다.

```ts
function validateTimezone(tz: string): string {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    throw new Error(`BOT_TIMEZONE 값이 유효하지 않습니다: "${tz}"`);
  }
}
```

`config` 객체에서:

```ts
timezone: validateTimezone(process.env.BOT_TIMEZONE ?? "Asia/Seoul"),
```

---

## 완료 조건 (Done Criteria)

1. `codex.ts`, `gemini.ts`, `vibe.ts` 모두 `buf` 변수를 사용하는 라인 버퍼 패턴으로 교체됨
2. 세 파일 각각의 `close` 핸들러에서 잔여 버퍼를 처리함
3. `config.ts` 에 `validateTimezone` 함수가 추가되고 `timezone` 필드에 적용됨
4. `BOT_TIMEZONE=Invalid/Zone` 으로 기동 시 시작 즉시 명확한 에러 메시지와 함께 종료됨
5. 기존 동작(응답 추출, 세션 ID 추출, 타임아웃, 에러 처리)이 변경되지 않음
6. `bun test` 통과
