# agent-gateway

Telegram 채팅으로 AI 에이전트(codex / gemini-cli / vibe 등)를 구동하는 경량 봇 게이트웨이.

## 주요 기능

- **AI 에이전트 연동** — CLI 기반 에이전트를 subprocess로 실행, 환경변수 하나로 백엔드 전환
- **세션 유지** — 채팅/사용자별 대화 문맥 유지 (SQLite, TTL + 주기적 초기화)
- **지도 링크 변환** — 네이버지도·카카오맵·티맵 단축 URL에서 주소 추출 → 세 서비스 링크 일괄 제공
- **알람** — 자연어로 지정 시각 알림 예약
- **파일 저장·검색** — 채팅에 올린 파일을 자동 저장, 메모 태그 및 자연어 검색
- **그룹·DM 통합** — 그룹챗에서는 트리거 호출, DM은 항상 에이전트로 전달

## 지원 AI 백엔드

| `AGENT_BACKEND` | 필요 CLI / 키 |
|---|---|
| `codex` (기본) | `@openai/codex`, `OPENAI_API_KEY` |
| `gemini` | `@google/gemini-cli`, `GEMINI_API_KEY` |
| `vibe` | `vibe`, `MISTRAL_API_KEY` |

## 시작하기

### Docker (권장)

```bash
cp .env.example .env
# .env 편집 후
docker compose up -d
```

### 로컬 실행

```bash
bun install
cp .env.example .env
# .env 편집 후
bun src/index.ts
```

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | BotFather에서 발급 (필수) |
| `AGENT_BACKEND` | `codex` | `codex` \| `gemini` \| `vibe` |
| `BOT_TRIGGER_NAME` | `시리야` | 그룹챗 호출 트리거 |
| `WORKSPACE_DIR` | `./workspace` | 에이전트 작업 디렉터리 |
| `DB_FILE` | `./data/data.db` | SQLite 파일 경로 |
| `SESSION_TTL_HOURS` | `24` | 세션 비활성 만료 시간 |
| `SESSION_RESET_DAYS` | `7` | 세션 주기적 초기화 주기 |
| `CONTEXT_MINUTES` | `5` | 프롬프트에 주입할 최근 메시지 시간 범위 |
| `CONTEXT_MAX_MESSAGES` | `5` | 프롬프트에 주입할 최근 메시지 수 |
| `TMAP_APP_KEY` | — | 티맵 링크 생성용 |
| `TZ` | `Asia/Seoul` | 타임존 |
| `NO_AGENT` | `false` | `true`로 설정 시 에이전트 미실행 (개발용) |

## 사용법

### 그룹챗

```
시리야 내일 오전 9시에 회의 알려줘      # 알람 예약
시리야 지난주에 올린 계약서 찾아줘       # 파일 검색
시리야 판교역 근처 맛집 알려줘           # 자유 대화
세션 재시작                             # 대화 기록 초기화
```

트리거 단축어 `$ `, `% ` 도 사용 가능.

### 지도 링크

트리거 없이 링크만 보내도 주소 추출 + 세 서비스 링크를 자동 응답.

```
https://naver.me/xxxxx
https://kko.to/xxxxx
https://tmap.life/xxxxx
```

### 파일

파일/사진을 올리면 자동 저장. 캡션 또는 직후 메시지로 메모 가능.

```
## 2026제주여행 1일차
```

## 라이선스

MIT
