// chatId를 파일시스템 경로 세그먼트로 쓰기 전 검증.
// chatId는 외부 메신저 어댑터에서 온 raw string이라 '/', '\', '..' 등이 들어오면
// join(workspaceDir, ..., chatId)가 workspaceDir 밖으로 탈출(path traversal)할 수 있다.
// 허용 메신저 id 형태: 텔레그램 '-?\d+', Discord 스노우플레이크 '\d+', Slack 'C0...'(영숫자).
// 모두 [A-Za-z0-9_-] 범위 → 그 외 문자/빈 값은 거부.
const SAFE_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

export function safeChatSegment(chatId: string): string {
  if (!SAFE_SEGMENT_RE.test(chatId)) {
    throw new Error(`unsafe chatId path segment: ${JSON.stringify(chatId)}`);
  }
  return chatId;
}
