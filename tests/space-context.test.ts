import { test, expect } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSpaceContext } from "../src/index";
import { config } from "../src/config";

async function makeWorkspace(chatId: string, content?: string): Promise<string> {
  const dir = join(tmpdir(), `agent-gateway-space-context-${Date.now()}-${Math.random()}`);
  const chatDir = join(dir, "files", chatId);
  await mkdir(chatDir, { recursive: true });
  if (content !== undefined) {
    await Bun.write(join(chatDir, "CONTEXT.md"), content);
  }
  return dir;
}

test("loadSpaceContext: CONTEXT.md가 있으면 블록을 반환한다", async () => {
  const originalWorkspaceDir = config.workspaceDir;
  try {
    config.workspaceDir = await makeWorkspace("123", "# 개요\n테스트 방");

    const context = await loadSpaceContext("123");

    expect(context).toBe("[공간 컨텍스트] (이 방 폴더: files/123/)\n# 개요\n테스트 방\n");
  } finally {
    config.workspaceDir = originalWorkspaceDir;
  }
});

test("loadSpaceContext: CONTEXT.md가 없으면 빈 문자열을 반환한다", async () => {
  const originalWorkspaceDir = config.workspaceDir;
  try {
    config.workspaceDir = await makeWorkspace("123");

    const context = await loadSpaceContext("123");

    expect(context).toBe("");
  } finally {
    config.workspaceDir = originalWorkspaceDir;
  }
});

test("loadSpaceContext: 공백 파일이면 빈 문자열을 반환한다", async () => {
  const originalWorkspaceDir = config.workspaceDir;
  try {
    config.workspaceDir = await makeWorkspace("123", " \n\t ");

    const context = await loadSpaceContext("123");

    expect(context).toBe("");
  } finally {
    config.workspaceDir = originalWorkspaceDir;
  }
});

test("loadSpaceContext: 4096자를 초과하면 자르고 생략 표시를 붙인다", async () => {
  const originalWorkspaceDir = config.workspaceDir;
  try {
    config.workspaceDir = await makeWorkspace("123", "가".repeat(4097));

    const context = await loadSpaceContext("123");

    expect(context).toBe(`[공간 컨텍스트] (이 방 폴더: files/123/)\n${"가".repeat(4096)}…(생략)\n`);
  } finally {
    config.workspaceDir = originalWorkspaceDir;
  }
});
