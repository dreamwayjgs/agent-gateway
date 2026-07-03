export function validateTimezone(tz: string): string {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    throw new Error(`BOT_TIMEZONE 값이 유효하지 않습니다: "${tz}"`);
  }
}

export function parseMessengers(value: string | undefined): string[] {
  return (value ?? "telegram").split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  discordToken: process.env.DISCORD_BOT_TOKEN ?? "",
  discordAdminUserId: process.env.DISCORD_ADMIN_USER_ID ?? "",
  messengers: parseMessengers(process.env.MESSENGER),
  dbFile: process.env.DB_FILE ?? "./data/data.db",
  sessionResetDays: Number(process.env.SESSION_RESET_DAYS ?? 7),
  tmapAppKey: process.env.TMAP_APP_KEY ?? "",
  workspaceDir: process.env.WORKSPACE_DIR ?? "./workspace",
  botTriggerName: process.env.BOT_TRIGGER_NAME ?? "시리야",
  contextMinutes: Number(process.env.CONTEXT_MINUTES ?? 5),
  contextMaxMessages: Number(process.env.CONTEXT_MAX_MESSAGES ?? 5),
  noAgent: process.env.NO_AGENT === "true",
  agentBackend: process.env.AGENT_BACKEND ?? "codex",
  timezone: validateTimezone(process.env.BOT_TIMEZONE ?? "Asia/Seoul"),
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  guroId: process.env.GURO_ID ?? "",
  guroPassword: process.env.GURO_PASSWORD ?? "",
  guroBaseUrl: process.env.GURO_BASE_URL ?? "http://guroyeonji2.iptime.org",
};
