import { spawn } from "child_process";

type CodexResult = {
  response: string;
  threadId: string;
};

export function runCodex(prompt: string, resumeId?: string): Promise<CodexResult> {
  return new Promise((resolve, reject) => {
    const commonFlags = ["--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"];
    const args = resumeId
      ? ["exec", "resume", ...commonFlags, resumeId, prompt]
      : ["exec", ...commonFlags, prompt];

    const proc = spawn("codex", args, {
      cwd: process.env.WORKSPACE_DIR ?? "./workspace",
      env: process.env,
    });

    let threadId = "";
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
        if (msg.type === "thread.started") {
          threadId = msg.thread_id as string;
        } else if (
          msg.type === "item.completed" &&
          (msg.item as Record<string, unknown>)?.type === "agent_message"
        ) {
          response = (msg.item as Record<string, unknown>).text as string;
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk.toString());
    });

    proc.on("close", (code) => {
      if (!response) {
        reject(new Error(`codex exited with code ${code}. stderr: ${stderr.join("")}`));
      } else {
        resolve({ response, threadId });
      }
    });

    proc.on("error", reject);
  });
}
