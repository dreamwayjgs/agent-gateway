export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? (() => { throw new Error("TELEGRAM_BOT_TOKEN is required") })(),
  sessionsFile: process.env.SESSIONS_FILE ?? "./sessions.json",
  workspaceDir: process.env.WORKSPACE_DIR ?? "./workspace",
};
