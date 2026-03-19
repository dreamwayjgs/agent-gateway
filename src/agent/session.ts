import { getDb } from "../db";

const TTL_SECONDS = (Number(process.env.SESSION_TTL_HOURS ?? 24)) * 3600;
const RESET_SECONDS = (Number(process.env.SESSION_RESET_DAYS ?? 7)) * 86400;

export function getSession(key: string): string | null {
  const db = getDb();
  const row = db.query<{ session_id: string; created_at: number; updated_at: number }, [string]>(
    "SELECT session_id, created_at, updated_at FROM sessions WHERE key = ?"
  ).get(key);
  if (!row) return null;

  const now = Math.floor(Date.now() / 1000);
  const expired = now - row.updated_at > TTL_SECONDS;
  const resetDue = now - row.created_at > RESET_SECONDS;

  if (expired || resetDue) {
    db.run("DELETE FROM sessions WHERE key = ?", [key]);
    return null;
  }
  return row.session_id;
}

export function setSession(key: string, sessionId: string) {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const existing = db.query<{ created_at: number }, [string]>(
    "SELECT created_at FROM sessions WHERE key = ?"
  ).get(key);

  db.run(
    "INSERT OR REPLACE INTO sessions (key, session_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [key, sessionId, existing?.created_at ?? now, now]
  );
}

export function deleteSession(key: string) {
  getDb().run("DELETE FROM sessions WHERE key = ?", [key]);
}
