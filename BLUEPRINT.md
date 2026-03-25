# agent-gateway — Blueprint

## 목적

Telegram 채팅으로 자연어 요청을 받아 CLI 에이전트(codex / gemini / claude)를 subprocess로 실행하고
결과를 응답하는 경량 게이트웨이 봇.

---

## 설계 목표

1. **CLI 에이전트 래핑** — codex / gemini / claude CLI를 subprocess로 구동, 환경변수 한 줄로 전환
2. **세션 유지** — 채팅/사용자별 세션을 JSON 파일로 영속화, TTL 관리
3. **작업 공간 격리** — Docker volume으로 단일 workspace 폴더만 에이전트에 노출

---

## 아키텍처 흐름

```
[Telegram 메시지]
      │
      ▼
TelegramAdapter (long polling)
      │
      ▼
CliAgent (agent/runner.ts)
  ├─ SessionStore    ← 채팅별 세션 (sessions.json, TTL)
  └─ subprocess exec
        ├─ codex:  `codex exec [--resume <id>] --json --dangerously-bypass-approvals-and-sandbox`
        ├─ gemini: `gemini [--resume <id>] --output-format stream-json --prompt`
        └─ claude: `claude [--resume <id>] --output-format stream-json --print`
              └─ NDJSON stdout 파싱 → response + session_id
      │
      ▼
[Telegram 응답] (4096자 초과 시 분할 전송)
```

---

## 디렉터리 구조

```
agent-gateway/
├── src/
│   ├── index.ts                  # 진입점
│   ├── config.ts                 # 환경변수
│   ├── agent/
│   │   ├── runner.ts             # CliAgent 인터페이스 + 백엔드 선택
│   │   ├── codex.ts              # codex subprocess + NDJSON 파싱
│   │   ├── gemini.ts             # gemini subprocess + stream-json 파싱
│   │   ├── claude.ts             # claude subprocess + stream-json 파싱
│   │   └── session.ts            # SessionStore (JSON 파일, TTL)
│   └── platforms/
│       └── telegram/
│           ├── bot.ts            # Bot API long polling 초기화
│           └── handlers.ts       # 메시지 → CliAgent → 응답 (분할 전송)
├── workspace/                    # 에이전트 작업 디렉터리 (Docker volume)
├── sessions.json                 # 세션 영속화 파일 (gitignored)
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## CLI 백엔드

| `AGENT_BACKEND` | 명령 |
|---|---|
| `codex` | `codex exec [--resume <session_id>] --json --dangerously-bypass-approvals-and-sandbox` |
| `gemini` | `gemini [--resume <session_id>] --output-format stream-json --prompt` |
| `claude` | `claude [--resume <session_id>] --output-format stream-json --print` |

- 두 백엔드 모두 NDJSON stdout 파싱으로 `response` + `session_id` 추출
- 첫 메시지: session_id 없이 실행 → 응답에서 session_id 저장
- 이후 메시지: `--resume <session_id>` 로 이어서 실행

---

## 세션 관리

- 키: `chat:<chat_id>` (그룹/채널) 또는 `user:<user_id>` (DM)
- 영속화: `sessions.json` 파일 (재시작 시에도 유지)
- TTL: `SESSION_TTL_HOURS` (기본 24시간) 초과 시 자동 만료
- 수동 초기화: `세션 재시작` 메시지로 현재 세션 삭제

---

## Config (환경변수)

```env
# Telegram
TELEGRAM_BOT_TOKEN=...

# Agent
AGENT_BACKEND=codex              # codex | claude
WORKSPACE_DIR=./workspace        # 에이전트 작업 디렉터리

# codex 전용
OPENAI_API_KEY=...

# gemini 전용
GEMINI_API_KEY=...

# claude 전용
ANTHROPIC_API_KEY=...

# Session
SESSIONS_FILE=./sessions.json
SESSION_TTL_HOURS=24
```

---

## Docker 구성

```yaml
services:
  bot:
    build: .
    env_file: .env
    volumes:
      - ./workspace:/app/workspace   # 에이전트 작업 공간만 노출
      - ./sessions.json:/app/sessions.json
```

- 공개 포트 불필요 (long polling)
- workspace 폴더 하나만 호스트에 마운트

---

## Telegram 메시지 처리

| 케이스 | 처리 |
|---|---|
| 일반 텍스트 응답 | 4,096자 단위로 분할해 순차 전송 |
| 에이전트 실행 중 | "처리 중..." 메시지 전송 후 결과로 수정 |

---

## 향후 확장

- **멀티 워크스페이스**: 사용자별 격리된 workspace 폴더
- **도구 결과 파일 첨부**: `[FILE:workspace/path]` 마커 감지 → Telegram 파일 전송
- **권한 관리**: `ALLOWED_CHAT_IDS` 환경변수로 접근 제한

---

## 아이디어 백로그

### 반복 알람
- 현재 알람은 1회성(setTimeout). cron 표현식 또는 자연어("매일 오전 9시") 지원
- `alarms` 테이블에 `repeat` 컬럼 추가 (`daily` | `weekly` | `weekdays` | null)
- 발화 후 다음 fire_at 계산해서 재등록

### URL 요약
- 메시지에 일반 URL 포함 시 페이지 내용 fetch → 에이전트 프롬프트에 주입
- 지도 URL 처리 패턴과 동일하게 `src/tools/` 에 추가
- 긴 본문은 앞 N자만 잘라 주입 (토큰 절약)

### 환율 계산기
- `workspace/scripts/` 에 환율 조회 스크립트 추가 (공개 API 사용, 예: ExchangeRate-API)
- 에이전트가 "100달러 얼마야" 요청 시 스크립트 호출
- 주요 통화(USD, EUR, JPY, CNY) 캐시 (TTL 1시간)
