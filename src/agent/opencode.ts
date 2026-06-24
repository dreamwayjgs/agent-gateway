import { spawn } from "child_process";

type OpencodeResult = {
  response: string;
  sessionId: string;
};

const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 5 * 60 * 1000);

export class AgentTimeoutError extends Error {}

export function runOpencode(prompt: string, resumeId?: string): Promise<OpencodeResult> {
  return new Promise((resolve, reject) => {
    const args = ["run", "--format", "json"];
    const model = process.env.OPENCODE_MODEL;
    if (model) args.push("-m", model);
    if (resumeId) args.push("-s", resumeId);
    args.push(prompt);

    const proc = spawn("opencode", args, {
      cwd: process.env.WORKSPACE_DIR ?? "./workspace",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout.setEncoding("utf8");

    const timer = setTimeout(() => {
      proc.kill();
      reject(new AgentTimeoutError("timeout"));
    }, TIMEOUT_MS);

    let sessionId = "";
    const responseParts: string[] = [];
    const stderr: string[] = [];
    let buf = "";

    const processLine = (trimmed: string) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (typeof msg.sessionID === "string") {
        sessionId = msg.sessionID;
      }
      if (msg.type === "text") {
        const part = msg.part as { text?: string } | undefined;
        if (part?.text) responseParts.push(part.text);
      }
    };

    proc.stdout.on("data", (chunk: string) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        processLine(trimmed);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk.toString());
    });

    proc.on("close", (code) => {
      if (buf.trim()) processLine(buf.trim());
      clearTimeout(timer);
      const response = responseParts.join("");
      if (!response) {
        reject(new Error(`opencode exited with code ${code}. stderr: ${stderr.join("")}`));
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
