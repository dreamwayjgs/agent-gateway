# SESSION-CHECKPOINT
Date: 2026-04-13

## 상태
정상 운영 중. 신규 서버 이전 완료.

## 이번 세션 완료 항목

- 알람 타임존 버그 수정 (`BOT_TIMEZONE` env + `resolveIso` bare ISO 정규화)
- codex spawn stdin hang 수정 (`stdio: ['ignore', 'pipe', 'pipe']`)
- workspace 마운트 범위 수정 (`./workspace/files` → `./workspace`)
- 알람 목록 조회 스크립트 추가 (`workspace/scripts/alarms-list.ts`)
- Three Man Team 설정 커밋 (AGENTS.md, GEMINI.md, agents/)
- 로저/로먼 리뷰어 지침 간소화 + `~/.claude/skills`, `~/.claude-personal/skills` 템플릿 동기화
- 디버그 로그 추가 (`[recv]`, `[codex] spawn/exit/done`, backend 표시)

## TASK.md 잔여 항목 (우선순위 순)

1. `src/agent/*.ts` 스트리밍 stdout 버퍼링 (응답 긴 텍스트 시 JSON 유실 방지)
2. `src/config.ts` BOT_TIMEZONE 시작 시점 유효성 검증
3. 알람 삭제 스크립트 (`workspace/scripts/alarms-delete.ts`)
4. 동영상/음성 파일 핸들러, `{{파일:id}}` sendPhoto 분기

## 다음 세션 시작 방법

```
이 프로젝트의 앨리스야. agents/handoff/SESSION-CHECKPOINT.md 읽고, agents/ARCHITECT.md 읽어.
```
