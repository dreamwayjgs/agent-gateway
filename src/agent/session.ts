import { existsSync, readFileSync, writeFileSync } from "fs";

type SessionEntry = {
  sessionId: string;
  updatedAt: number;
};

type SessionMap = Record<string, SessionEntry>;

const TTL_MS = (Number(process.env.SESSION_TTL_HOURS ?? 24)) * 60 * 60 * 1000;

function load(file: string): SessionMap {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

function save(file: string, map: SessionMap) {
  writeFileSync(file, JSON.stringify(map, null, 2));
}

export function getSession(file: string, key: string): string | null {
  const map = load(file);
  const entry = map[key];
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > TTL_MS) {
    delete map[key];
    save(file, map);
    return null;
  }
  return entry.sessionId;
}

export function setSession(file: string, key: string, sessionId: string) {
  const map = load(file);
  map[key] = { sessionId, updatedAt: Date.now() };
  save(file, map);
}

export function deleteSession(file: string, key: string) {
  const map = load(file);
  delete map[key];
  save(file, map);
}
