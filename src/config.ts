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
  timezone: process.env.TZ ?? "Asia/Seoul",
};
