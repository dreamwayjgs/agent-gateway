import { config } from "../config";
import { DiscordMessenger } from "./discord";
import { TelegramMessenger } from "./telegram";
import type { Messenger } from "./types";

export function createMessenger(platform: string): Messenger {
  switch (platform) {
    case "telegram":
      if (!config.telegramToken) throw new Error("TELEGRAM_BOT_TOKEN is required");
      return new TelegramMessenger(config.telegramToken);
    case "discord":
      if (!config.discordToken) throw new Error("DISCORD_BOT_TOKEN is required");
      return new DiscordMessenger(config.discordToken, config.discordAdminUserId);
    default:
      throw new Error(`지원하지 않는 메신저: "${platform}" (현재 telegram/discord만 지원)`);
  }
}

export function createMessengers(platforms: string[]): Messenger[] {
  const unique = [...new Set(platforms.map((p) => p.trim()).filter(Boolean))];
  if (unique.length === 0) throw new Error("MESSENGER must include at least one platform");
  return unique.map((platform) => createMessenger(platform));
}

export type { Messenger, IncomingMsg, OutFile, FileRef, FileDownloader, Platform } from "./types";
