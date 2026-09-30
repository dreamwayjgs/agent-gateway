import { spawn, type ChildProcess } from "child_process";

export const STDOUT_CAP = 512 * 1024;
export const STDERR_CAP = 128 * 1024;
export const MAX_MALFORMED_LINES = 1000;
export const RESPONSE_MAX = 64 * 1024;

export type CodexErrorCode = "empty-response" | "codex-error" | "timeout" | "output-limit";

export class CodexError extends Error {
  code: CodexErrorCode;
  constructor(code: CodexErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export type RunOpts = {
  timeoutMs: number;
  codexBin?: string;
  cwd?: string;
};

const ENV_ALLOWLIST = [
  "CODEX_MODEL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "BOT_TIMEZONE",
  "CODEX_HOME",
  "HOME",
  "PATH",
];

function truncateUtf8(buf: Buffer, max: number): Buffer {
  if (buf.length <= max) return buf;
  let end = max;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end);
}

export function extractFinalText(lines: string[]): string {
  let text = "";
  for (const line of lines) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      msg.type === "item.completed" &&
      (msg.item as Record<string, unknown> | undefined)?.type === "agent_message"
    ) {
      const t = (msg.item as Record<string, unknown>).text;
      if (typeof t === "string" && t) text = t;
    }
  }
  return text;
}

export function truncateResponse(text: string): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= RESPONSE_MAX) return { text, truncated: false };
  return { text: truncateUtf8(buf, RESPONSE_MAX).toString("utf8"), truncated: true };
}

export function runCodexOnce(
  prompt: string,
  opts: RunOpts,
): Promise<{ text: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const bin = opts.codexBin ?? "codex";
    const args = ["exec", "--json", "--skip-git-repo-check", prompt];
    let proc: ChildProcess;
    try {
      const env: Record<string, string> = {};
      for (const k of ENV_ALLOWLIST) {
        const v = process.env[k];
        if (v !== undefined) env[k] = v;
      }
      proc = spawn(bin, args, {
        cwd: opts.cwd ?? process.cwd(),
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
    } catch (err) {
      reject(new CodexError("codex-error", "spawn failed"));
      return;
    }

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let malformed = 0;
    let overLimit = false;
    const lines: string[] = [];
    let remainder = Buffer.alloc(0);

    const killGroup = () => {
      try {
        if (proc.pid) process.kill(-proc.pid, "SIGKILL");
      } catch {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already dead */
        }
      }
    };

    const onOverflow = () => {
      if (overLimit) return;
      overLimit = true;
      killGroup();
    };

    const pushChunk = (chunk: Buffer, isErr: boolean) => {
      if (overLimit) return;
      if (isErr) {
        stderrBytes += chunk.length;
        if (stderrBytes > STDERR_CAP) onOverflow();
        return;
      }
      stdoutBytes += chunk.length;
      if (stdoutBytes > STDOUT_CAP) {
        onOverflow();
        return;
      }
      remainder = Buffer.concat([remainder, chunk]);
      let idx: number;
      while ((idx = remainder.indexOf(0x0a)) >= 0) {
        const line = remainder.subarray(0, idx).toString("utf8");
        remainder = remainder.subarray(idx + 1);
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          JSON.parse(trimmed);
          lines.push(trimmed);
        } catch {
          malformed++;
          if (malformed > MAX_MALFORMED_LINES) {
            onOverflow();
            return;
          }
        }
      }
    };

    proc.stdout?.on("data", (c: Buffer) => pushChunk(c, false));
    proc.stderr?.on("data", (c: Buffer) => pushChunk(c, true));

    const timer = setTimeout(() => {
      killGroup();
      reject(new CodexError("timeout"));
    }, opts.timeoutMs);

    proc.on("error", () => {
      clearTimeout(timer);
      reject(new CodexError("codex-error", "spawn failed"));
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (overLimit) {
        reject(new CodexError("output-limit"));
        return;
      }
      const tail = remainder.toString("utf8").trim();
      if (tail) {
        try {
          JSON.parse(tail);
          lines.push(tail);
        } catch {
          /* trailing partial line ignored */
        }
      }
      if (code !== 0) {
        reject(new CodexError("codex-error", `exit ${code}`));
        return;
      }
      const text = extractFinalText(lines);
      if (!text) {
        reject(new CodexError("empty-response"));
        return;
      }
      resolve(truncateResponse(text));
    });
  });
}
