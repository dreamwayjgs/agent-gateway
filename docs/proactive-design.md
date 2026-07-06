# 프로액티브 비서 (#4) — 설계 노트 + 조사 기록

> 2026-07-06 설계 세션 캡처. 로드맵 #4("알람 → 스케줄러 / 프로액티브 리마인더")의 심층 설계.
> **미착수** — Step 10 스코핑 중 안전 블로커에서 멈춤(아래 조사). 재개 시 이 문서부터.

---

## 1. 프레임 — 최초의 비-사용자 트리거

지금까지 **모든** 에이전트 구동 = 인바운드 사용자 메시지(`handleText`). 100% 반응형(reactive). 매 실행에 방금 말한 사람이 있어 (a) 요청이 작업 범위를 한정, (b) 출력을 즉시 봄 = **암묵적 human-in-the-loop 안전장치**.

프로액티브 트리거(스케줄러/시계)는 이 시스템 **최초의 능동 트리거** = 아키텍처 등급 변화:
- 암묵 안전장치 소멸(지켜보는 사람 없음) → 안전을 **명시적으로** 재구성해야.
- 범위 한정자(요청) 소멸 → 상시 임무라 드리프트·과잉행동 취약.
- 이후 모든 프로액티브(브리핑·모니터·자동화)가 이 primitive 위에 탐.

## 2. 퍼미션 = provenance 기반 2층 (현재 전무)

트리거 종류(`user` | `proactive`)가 권한 등급을 결정해야. 현재 파이프라인(`processGuroTemplates`/`extractAlarms`/`processTemplates`/`extractFileRefs`)은 provenance 인자 없음 → "이 액션이 사용자 요청인지 tick인지" 아는 곳이 아예 없음.

| 층 | 통제 대상 | user | proactive |
|----|----------|------|-----------|
| **1. 에이전트 실행 샌드박스** (주 레버, non-`{{}}`) | LLM 자기 셸/파일/네트워크 | 풀 | 제한(read-only) |
| **2. `{{}}` 출력 게이트** | 게이트웨이 실행 액션 | all | 화이트리스트(v1=전부 차단) |

- 2층 게이트는 쉬움: 응답의 `{{KIND:...}}`를 단일 함수로 스캔, proactive면 비허용 종류 차단·치환. 확장(allowlist)형.
- **1층(샌드박스)이 진짜 난제 — 아래 조사 참조.**
- 상태 변경(task 완료 등)은 에이전트 셸이 아니라 **`{{}}` 템플릿으로 게이트웨이가 실행**(read-only 셸과 양립).

## 3. 리마인더 모델

**경계 = 완료 추적 여부** (단발/반복 아님):

| 종류 | 예 | 전달 |
|------|-----|------|
| **alarm** (fire-and-forget, ack 없음) | 9시 회의, 매일 8시 기상 | Step 9(완료) |
| **task** (nag-until-done, ack 필요) | 전세이자(냈나?), 휴지(샀나?) | tasks 저장소 + 데일리 tick + ack (신규) |

- **반복 dated는 alarm 엔진 위임**: 전세이자=월별, 기념일=`every=12mo`. recurrence를 tasks에 재구현 금지(이중화). 리드타임 = 알람 `fire_at`을 D-N로 당김(store 컬럼 아님).
- **`{{}}` 재활용**: 등록 `{{할일:…}}`, ack `{{완료:id}}`. 조회 = `tasks-list.ts` 스크립트.
- **전세이자 시나리오(무응답까지 nag)**: 알람 미리 7개 만들기 = 멍청(냈어도 발화). 대신 **task 1행(status per-cycle) + 데일리 tick이 매일 평가**(윈도우 안 && unpaid → nag, "냈어" → paid → 침묵, 다음 달 리셋). 알람 안 만듦.
- **"적절히"(C의 난제)** = 하드룰 대신 **데일리 tick의 에이전트 판단**에 위임. importance 힌트 + snooze_until(재부상 억제).
- **데일리 tick 자체 = agent-mode 알람 1개**(발화 시 정적 발송 대신 에이전트 실행). = 프로액티브 트리거 primitive.

### tasks 스키마 (잠정, 옵션 (a) 기준)
반복 dated는 alarm 위임 → events 테이블 불필요. **todos 하나만**:
```sql
CREATE TABLE todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|done
  importance TEXT,                         -- low|normal|high
  snooze_until INTEGER,                    -- 재부상 억제
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```
(전세이자류 per-cycle status task는 이보다 더 필요할 수 있음 — 시나리오에서 파생. 재개 시 정리.)

## 4. Step 10 (의도한 스코프)
**provenance caps 게이트 + 최소 agent-mode 능동 트리거**를 한 몸으로(따로면 e2e 검증 불가 — proactive 경로가 없으면 caps 분기가 죽은 가지). 검증 = 유닛(caps 매트릭스) + 라이브(proactive run이 금지 액션 시도→차단 관측).

---

## 5. 조사 기록 — 안전(1층 샌드박스) 블로커 ⚠️ 미해결

**목표**: proactive 에이전트의 셸/쓰기/네트워크를 무인 상태서 제한.

1. **codex `--sandbox read-only`** (읽기허용/쓰기차단) = 정답처럼 보였으나 → **리눅스서 bubblewrap(bwrap) 사용.** 이 컨테이너서 `bwrap: No permissions to create a new namespace` — **샌드박스 초기화 실패, 모든 명령 에러.** (현행이 `--dangerously-bypass-approvals-and-sandbox`인 이유일 듯.)
2. **원인**: 호스트는 userns 허용(`unprivileged_userns_clone=1`, `max_user_namespaces=28142`)인데 **컨테이너 seccomp/apparmor가 내부 userns 생성 차단**. compose에 security_opt 없음.
3. **경로 A(seccomp:unconfined로 풀기)** → codex 샌드박스 작동하나 컨테이너 경계 confinement 약화. **Owner 기각**(보안 트레이드오프 부적절).
4. **셸 없는 LLM(B4)?** → `runGemini`도 CLI spawn(`gemini -p … --yolo`, 전권). **세 백엔드(codex/opencode/gemini) 전부 CLI yolo 셸 에이전트.** 코드베이스에 툴 없는 순수 LLM 경로 **없음.** Gemini 무료티어라 Owner "도움 안 됨".
5. **codex 비-샌드박스 제어 레버**(웹 레퍼런스): `--ask-for-approval/-a (untrusted|on-request|never)`, execpolicy 규칙파일(`--ignore-rules`로 끔). **단 설치된 codex엔 `-a` 없음**(`error: unexpected argument '-a'`) → 웹문서=다른 버전. 승인정책은 `-c approval_policy=` 형태 추정.
6. **검증 중단 지점**: "codex가 `--dangerously-bypass` 없이(승인/샌드박스 모드) 이 환경서 아예 돌긴 하나?" 테스트하려던 중 멈춤. **catch-22 의심**: 비-bypass가 기본 샌드박스(bwrap) 요구하면 codex는 여기서 bypass(전권) 외 불가 → in-place 제한 불가.

### 남은 제한 옵션 (미결)
- **B1 — 저권한 OS 유저**: codex 그대로, 쓰기권한 없는 유저로 구동(OS 파일권한). 마찰: codex 자기 세션상태 쓰기 필요(홈/tmp만 허용), codex-auth 읽기권한. 셸 read 누수 잔존.
- **B4-real — 툴 없는 LLM API 신설**: CLI 아닌 REST 직접 호출(셸 0, 최상 안전). 단 특정 LLM 강제 + 유료키 필요(Gemini 무료 무용, Claude/OpenAI 키 필요). 신규 코드.
- **codex approval_policy/execpolicy**: 검증 미완 — 비-bypass가 이 환경서 도는지 + shell write 실제 차단되는지 실측 필요.

### 다음 액션 (재개 시)
1. codex 비-bypass 실행 가능성 실측: `codex exec -c approval_policy=never`(샌드박스 없이) + 기본 무플래그 → bwrap 요구/차단 여부.
2. execpolicy 규칙으로 shell write 차단 가능한지.
3. 결과로 제한 방식 확정(codex in-place vs B1 vs B4-real) → Step 10 브리프.

---

## 부수 사실
- 컨테이너 `CODEX_MODEL` **빈 값** → codex가 config 기본 모델 사용(auth=ChatGPT 계정). `-m ""` 넘기면 깨짐.
- `AGENT_BACKEND=codex`(현행 주 백엔드). `GEMINI_API_KEY` SET(무료티어).
