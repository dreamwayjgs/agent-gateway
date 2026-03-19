import { spawn } from "child_process";

type GeminiResult = {
  response: string;
  sessionId: string;
};

const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 5 * 60 * 1000);

export class AgentTimeoutError extends Error {}

export function runGemini(prompt: string, resumeId?: string): Promise<GeminiResult> {
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "-o", "stream-json", "--yolo"];
    if (resumeId) args.push("-r", resumeId);

    const proc = spawn("gemini", args, {
      cwd: process.env.WORKSPACE_DIR ?? "./workspace",
      env: process.env,
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new AgentTimeoutError("timeout"));
    }, TIMEOUT_MS);

    let sessionId = "";
    const responseParts: string[] = [];
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
        if (msg.type === "init") {
          sessionId = msg.session_id as string;
        } else if (msg.type === "message" && msg.role === "assistant" && msg.delta === true) {
          responseParts.push(msg.content as string);
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk.toString());
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const response = responseParts.join("");
      if (!response) {
        reject(new Error(`gemini exited with code ${code}. stderr: ${stderr.join("")}`));
      } else {
        resolve({ response, sessionId });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
