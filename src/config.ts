export function validateTimezone(tz: string): string {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    throw new Error(`BOT_TIMEZONE 값이 유효하지 않습니다: "${tz}"`);
  }
}

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? (() => { throw new Error("TELEGRAM_BOT_TOKEN is required") })(),
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
};
