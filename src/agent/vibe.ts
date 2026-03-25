import { spawn } from "child_process";
import { readdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

type VibeResult = {
  response: string;
  sessionId: string;
};

const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 5 * 60 * 1000);

export class AgentTimeoutError extends Error { }

// session_20260319_235356_d9ac0377 → "d9ac0377"
async function getLatestSessionId(): Promise<string> {
  const sessionDir = join(homedir(), ".vibe", "logs", "session");
  const entries = await readdir(sessionDir);
  const folders = entries.filter((e) => e.startsWith("session_")).sort();
  if (folders.length === 0) return "";
  const latest = folders[folders.length - 1];
  return latest.split("_").at(-1) ?? "";
}

const isVibeSessionId = (id: string) => /^[0-9a-f]{8}$/.test(id);

export function runVibe(prompt: string, resumeId?: string): Promise<VibeResult> {
  const vibeResumeId = resumeId && isVibeSessionId(resumeId) ? resumeId : undefined;
  return new Promise((resolve, reject) => {
    const args = ["--prompt", prompt, "--output", "streaming"];
    if (vibeResumeId) args.push("--resume", vibeResumeId);

    const proc = spawn("vibe", args, {
      cwd: process.env.WORKSPACE_DIR ?? "./workspace",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new AgentTimeoutError("timeout"));
    }, TIMEOUT_MS);

    let response = "";
    const stderr: string[] = [];

    proc.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (msg.role === "assistant") {
          response = msg.content as string;
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk.toString());
    });

    proc.on("close", async (code) => {
      clearTimeout(timer);
      if (!response) {
        reject(new Error(`vibe exited with code ${code}. stderr: ${stderr.join("")}`));
        return;
      }
      // resume 시에는 기존 ID 유지, 첫 실행 시에는 새 세션 ID 조회
      const sessionId = vibeResumeId ?? await getLatestSessionId().catch(() => "");
      resolve({ response, sessionId });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
