import { config } from "../config";
import { TelegramMessenger } from "./telegram";
import type { Messenger } from "./types";

export function createMessenger(platform: string): Messenger {
  switch (platform) {
    case "telegram":
      return new TelegramMessenger(config.telegramToken);
    default:
      throw new Error(`지원하지 않는 메신저: "${platform}" (현재 telegram만 지원)`);
  }
}

export type { Messenger, IncomingMsg, OutFile, FileRef, FileDownloader, Platform } from "./types";
