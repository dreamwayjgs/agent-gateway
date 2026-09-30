import { runCodexOnce, CodexError } from "./runner.ts";

const PORT = Number(process.env.RUNNER_PORT ?? 8787);
const SECRET = process.env.PROACTIVE_RUNNER_SECRET ?? "";
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 300000);
const PROMPT_MAX = 8000;

if (!SECRET) {
  console.error("[runner] PROACTIVE_RUNNER_SECRET is empty — refusing to start");
  process.exit(1);
}
if (!Number.isInteger(TIMEOUT_MS) || TIMEOUT_MS < 30000 || TIMEOUT_MS > 600000) {
  console.error(`[runner] AGENT_TIMEOUT_MS out of range (30000-600000): ${process.env.AGENT_TIMEOUT_MS}`);
  process.exit(1);
}

let running = 0;

function checkAuth(req: Request): boolean {
  const h = req.headers.get("authorization");
  return h === `Bearer ${SECRET}`;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/run") {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    if (!checkAuth(req)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "bad-request" }, { status: 400 });
    }
    const prompt = (body as Record<string, unknown> | null)?.prompt;
    if (typeof prompt !== "string" || prompt.length === 0 || prompt.length > PROMPT_MAX) {
      return Response.json({ error: "bad-request" }, { status: 400 });
    }
    if (running >= 1) {
      return Response.json({ error: "busy" }, { status: 429 });
    }
    running++;
    try {
      const { text, truncated } = await runCodexOnce(prompt, {
        timeoutMs: TIMEOUT_MS,
        codexBin: process.env.RUNNER_CODEX_BIN,
        cwd: process.env.RUNNER_WORKSPACE ?? "/workspace",
      });
      return Response.json(truncated ? { text, truncated: true } : { text });
    } catch (err) {
      const code = err instanceof CodexError ? err.code : "codex-error";
      return Response.json({ error: code }, { status: code === "timeout" ? 504 : 500 });
    } finally {
      running--;
    }
  },
});

console.log(`[runner] listening on :${server.port}`);
