import { getDb } from "./db";

export type ChatSettings = {
  translation?: {
    enabled: boolean;
    target: string; // non-Korean language code (e.g. 'en', 'ja')
  };
};

export function getChatSettings(chatId: string): ChatSettings {
  const row = getDb()
    .query<{ settings: string }, [string]>("SELECT settings FROM chat_settings WHERE chat_id = ?")
    .get(chatId);
  if (!row) return {};
  try {
    return JSON.parse(row.settings) as ChatSettings;
  } catch {
    return {};
  }
}

export function updateChatSettings(chatId: string, patch: Partial<ChatSettings>): void {
  const current = getChatSettings(chatId);
  const updated = { ...current, ...patch };
  const now = Math.floor(Date.now() / 1000);
  getDb().run(
    `INSERT INTO chat_settings (chat_id, settings, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
    [chatId, JSON.stringify(updated), now]
  );
}
