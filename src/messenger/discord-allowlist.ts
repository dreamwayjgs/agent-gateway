import { getDb } from "../db";

export type DiscordAllowRow = {
  user_id: string;
  name: string | null;
  added_at: number;
};

export type AdminCommand =
  | { cmd: "allow"; userId: string; name?: string }
  | { cmd: "block"; userId: string }
  | { cmd: "list" };

const DISCORD_USER_ID_RE = /^\d{17,20}$/;

export function isFamilyAllowed(userId: string, adminId: string): boolean {
  if (adminId && userId === adminId) return true;
  const row = getDb()
    .query<{ user_id: string }, [string]>("SELECT user_id FROM discord_allowlist WHERE user_id = ? LIMIT 1")
    .get(userId);
  return row != null;
}

export function addAllow(userId: string, name?: string): void {
  getDb().run(
    `INSERT INTO discord_allowlist (user_id, name, added_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, added_at = excluded.added_at`,
    [userId, name ?? null, Math.floor(Date.now() / 1000)]
  );
}

export function removeAllow(userId: string): void {
  getDb().run("DELETE FROM discord_allowlist WHERE user_id = ?", [userId]);
}

export function listAllow(): DiscordAllowRow[] {
  return getDb()
    .query<DiscordAllowRow, []>("SELECT user_id, name, added_at FROM discord_allowlist ORDER BY user_id")
    .all();
}

export function parseAdminCommand(text: string | null): AdminCommand | null {
  const trimmed = text?.trim();
  if (!trimmed?.startsWith("!")) return null;

  const [rawCmd, rawUserId, ...nameParts] = trimmed.split(/\s+/);
  if (rawCmd === "!목록") return nameParts.length === 0 && rawUserId == null ? { cmd: "list" } : null;
  if (rawCmd === "!허용" && rawUserId && DISCORD_USER_ID_RE.test(rawUserId)) {
    const name = nameParts.join(" ").trim();
    return name ? { cmd: "allow", userId: rawUserId, name } : { cmd: "allow", userId: rawUserId };
  }
  if (rawCmd === "!차단" && rawUserId && DISCORD_USER_ID_RE.test(rawUserId) && nameParts.length === 0) return { cmd: "block", userId: rawUserId };
  return null;
}

export function isAdminCommandText(text: string | null): boolean {
  const cmd = text?.trim().split(/\s+/, 1)[0];
  return cmd === "!허용" || cmd === "!차단" || cmd === "!목록";
}

export function adminCommandUsage(): string {
  return "사용법: !허용 <Discord userId> [이름] / !차단 <Discord userId> / !목록";
}
