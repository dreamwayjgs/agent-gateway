import { test, expect } from "bun:test";

// 세 에이전트 파일의 buf 패턴을 그대로 재현
function makeProcessor() {
  let buf = "";
  const collected: string[] = [];

  const processLine = (trimmed: string) => {
    collected.push(trimmed);
  };

  const onData = (chunk: string) => {
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) processLine(trimmed);
    }
  };

  const onClose = () => {
    if (buf.trim()) processLine(buf.trim());
  };

  return { onData, onClose, collected };
}

test("JSON 라인이 청크 경계에서 잘려도 복원됨", () => {
  const { onData, collected } = makeProcessor();
  const line = '{"type":"thread.started","thread_id":"abc123"}';
  onData(line.slice(0, 20));
  onData(line.slice(20) + "\n");
  expect(collected).toHaveLength(1);
  expect(JSON.parse(collected[0]!)).toEqual({ type: "thread.started", thread_id: "abc123" });
});

test("한 청크에 여러 라인이 들어와도 모두 수집됨", () => {
  const { onData, collected } = makeProcessor();
  onData('{"a":1}\n{"b":2}\n{"c":3}\n');
  expect(collected).toHaveLength(3);
});

test("마지막 라인에 개행 없을 때 close에서 처리됨", () => {
  const { onData, onClose, collected } = makeProcessor();
  onData('{"a":1}\n{"b":2}');
  expect(collected).toHaveLength(1);
  onClose();
  expect(collected).toHaveLength(2);
  expect(JSON.parse(collected[1]!)).toEqual({ b: 2 });
});

test("멀티바이트 UTF-8 — setEncoding 후 string 청크로 받으면 문자 경계에서 안전함", () => {
  // setEncoding("utf8") 적용 시 data 이벤트는 string을 전달하므로
  // string slice는 UTF-16 코드 유닛 단위 — 한글 BMP 문자는 1 code unit
  const { onData, collected } = makeProcessor();
  const line = '{"content":"한글텍스트응답"}';
  onData(line.slice(0, 12));
  onData(line.slice(12) + "\n");
  expect(collected).toHaveLength(1);
  expect(JSON.parse(collected[0]!).content).toBe("한글텍스트응답");
});

test("빈 라인과 공백 라인은 무시됨", () => {
  const { onData, collected } = makeProcessor();
  onData('\n\n   \n{"ok":true}\n\n');
  expect(collected).toHaveLength(1);
});
