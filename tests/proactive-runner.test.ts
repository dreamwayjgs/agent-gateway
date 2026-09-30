import { test, expect, afterAll } from "bun:test";
import { spawn, type ChildProcess } from "child_process";
import { writeFileSync, chmodSync, unlinkSync, readdirSync } from "node:fs";
import {
  extractFinalText,
  truncateResponse,
  runCodexOnce,
  CodexError,
  STDOUT_CAP,
  MAX_MALFORMED_LINES,
} from "../runner/runner.ts";

const procs: ChildProcess[] = [];
afterAll(() => {
  for (const p of procs) {
    try {
      p.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  for (const f of readdirSync(import.meta.dir)) {
    if (f.startsWith("stub-") && f.endsWith(".sh")) {
      try {
        unlinkSync(`${import.meta.dir}/${f}`);
      } catch {
        /* ignore */
      }
    }
  }
});

function stubBin(script: string): string {
  const path = `${import.meta.dir}/stub-${Math.random().toString(36).slice(2)}.sh`;
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

test("extractFinalText — 마지막 agent_message 채택, 다른 타입 무시", () => {
  const lines = [
    '{"type":"thread.started","thread_id":"t1"}',
    '{"type":"item.completed","item":{"type":"reasoning","text":"x"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"first"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"final"}}',
  ];
  expect(extractFinalText(lines)).toBe("final");
});

test("extractFinalText — malformed 줄 skip", () => {
  expect(extractFinalText(["not json", '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}'])).toBe(
    "ok",
  );
});

test("truncateResponse — 64KB 초과 시 코드포인트 경계 절단", () => {
  const big = "가".repeat(30000); // 90KB UTF-8
  const { text, truncated } = truncateResponse(big);
  expect(truncated).toBe(true);
  expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(64 * 1024);
  expect(text).toBe("가".repeat(text.length));
});

test("runCodexOnce — JSONL 파싱·종료코드·빈응답", async () => {
  const bin = stubBin(`printf '%s\\n' '{"type":"thread.started","thread_id":"t"}' '{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}'`);
  const r = await runCodexOnce("hi", { timeoutMs: 10000, codexBin: bin });
  expect(r.text).toBe("hello");
});

test("runCodexOnce — 비정상 종료는 stderr 노출 없이 codex-error", async () => {
  const bin = stubBin(`echo secret-internal-path >&2; exit 3`);
  try {
    await runCodexOnce("hi", { timeoutMs: 10000, codexBin: bin });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(CodexError);
    expect((err as CodexError).code).toBe("codex-error");
    expect((err as Error).message).not.toContain("secret-internal-path");
  }
});

test("runCodexOnce — 빈 응답은 empty-response", async () => {
  const bin = stubBin(`printf '%s\\n' '{"type":"thread.started","thread_id":"t"}'`);
  try {
    await runCodexOnce("hi", { timeoutMs: 10000, codexBin: bin });
    expect.unreachable();
  } catch (err) {
    expect((err as CodexError).code).toBe("empty-response");
  }
});

test("runCodexOnce — stdout 상한 초과 시 output-limit + kill", async () => {
  const bin = stubBin(`yes '{"type":"x"}' | head -c ${STDOUT_CAP + 65536}`);
  const t0 = Date.now();
  try {
    await runCodexOnce("hi", { timeoutMs: 30000, codexBin: bin });
    expect.unreachable();
  } catch (err) {
    expect((err as CodexError).code).toBe("output-limit");
    expect(Date.now() - t0).toBeLessThan(30000);
  }
});

test("runCodexOnce — malformed 폭탄은 개수 상한에서 output-limit", async () => {
  const bin = stubBin(`yes 'garbage-line' | head -n ${MAX_MALFORMED_LINES + 100}`);
  try {
    await runCodexOnce("hi", { timeoutMs: 30000, codexBin: bin });
    expect.unreachable();
  } catch (err) {
    expect((err as CodexError).code).toBe("output-limit");
  }
});

test("runCodexOnce — timeout 시 그룹 kill", async () => {
  const bin = stubBin(`sleep 30`);
  const t0 = Date.now();
  try {
    await runCodexOnce("hi", { timeoutMs: 500, codexBin: bin });
    expect.unreachable();
  } catch (err) {
    expect((err as CodexError).code).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(10000);
  }
});

test("runCodexOnce — 자식 env 출력에 허용 항목만 포함", async () => {
  process.env.PROACTIVE_RUNNER_SECRET = "must-not-leak";
  process.env.TELEGRAM_BOT_TOKEN = "must-not-leak";
  process.env.DB_FILE = "must-not-leak";
  process.env.CODEX_MODEL = "test-model-allowlisted";
  try {
    const outPath = `${import.meta.dir}/envout-${Math.random().toString(36).slice(2)}.txt`;
    const bin = stubBin(
      `env > ${outPath}; printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}'`,
    );
    await runCodexOnce("hi", { timeoutMs: 10000, codexBin: bin });
    const out = await Bun.file(outPath).text();
    await Bun.$`rm -f ${outPath}`.quiet();
    expect(out).toContain("CODEX_MODEL=test-model-allowlisted");
    expect(out).toContain("PATH=");
    expect(out).not.toContain("must-not-leak");
    expect(out).not.toContain("PROACTIVE_RUNNER_SECRET");
  } finally {
    delete process.env.PROACTIVE_RUNNER_SECRET;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.DB_FILE;
    delete process.env.CODEX_MODEL;
  }
});

function getFreePort(): number {
  const s = Bun.serve({ port: 0, fetch() { return new Response(""); } });
  const port = s.port;
  s.stop(true);
  return port;
}

const TEST_SECRET = "test-secret-123";

function startServer(stub: string, port: number): ChildProcess {
  const p = spawn("bun", ["runner/server.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      RUNNER_PORT: String(port),
      PROACTIVE_RUNNER_SECRET: TEST_SECRET,
      AGENT_TIMEOUT_MS: "30000",
      RUNNER_CODEX_BIN: stub,
      RUNNER_WORKSPACE: "/tmp",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  procs.push(p);
  return p;
}

async function waitUp(port: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/run`, {
        method: "POST",
        headers: { authorization: `Bearer ${TEST_SECRET}` },
        body: JSON.stringify({ prompt: "x" }),
      });
      await r.text();
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
  throw new Error("server did not start");
}

test("server — 무인증/오인증 401, prompt 검증 400, unknown 경로 404", async () => {
  const PORT = getFreePort();
  const stub = stubBin(`printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}'`);
  const before = procs.length;
  startServer(stub, PORT);
  await waitUp(PORT);
  try {
    const noAuth = await fetch(`http://127.0.0.1:${PORT}/run`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hi" }),
    });
    expect(noAuth.status).toBe(401);
    const wrong = await fetch(`http://127.0.0.1:${PORT}/run`, {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
      body: JSON.stringify({ prompt: "hi" }),
    });
    expect(wrong.status).toBe(401);
    const bad = await fetch(`http://127.0.0.1:${PORT}/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
      body: JSON.stringify({ prompt: "x".repeat(8001) }),
    });
    expect(bad.status).toBe(400);
    const nf = await fetch(`http://127.0.0.1:${PORT}/nope`, {
      headers: { authorization: `Bearer ${TEST_SECRET}` },
    });
    expect(nf.status).toBe(404);
    const ok = await fetch(`http://127.0.0.1:${PORT}/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SECRET}` },
      body: JSON.stringify({ prompt: "hi" }),
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { text: string }).text).toBe("ok");
  } finally {
    procs.slice(before).forEach((p) => p.kill("SIGKILL"));
  }
});

test("server — 동시 요청 2건 중 1건 429", async () => {
  const PORT = getFreePort();
  const stub = stubBin(`sleep 2; printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"slow"}}'`);
  const before = procs.length;
  startServer(stub, PORT);
  await waitUp(PORT);
  try {
    const headers = {
      authorization: `Bearer ${TEST_SECRET}`,
      "content-type": "application/json",
    };
    const [a, b] = await Promise.all([
      fetch(`http://127.0.0.1:${PORT}/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: "one" }),
      }),
      fetch(`http://127.0.0.1:${PORT}/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: "two" }),
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 429]);
    await a.text();
    await b.text();
  } finally {
    procs.slice(before).forEach((p) => p.kill("SIGKILL"));
  }
});
