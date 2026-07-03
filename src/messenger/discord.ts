import {
  AttachmentBuilder,
  Client,
  GatewayIntentBits,
  Partials,
  type Collection,
  type Message,
} from "discord.js";
import type { FileRef, IncomingMsg, Messenger, OutFile } from "./types";

type MessageHandler = (msg: IncomingMsg) => Promise<void>;

type SendableChannel = {
  send: (payload: string | { files: AttachmentBuilder[] }) => Promise<unknown>;
  sendTyping?: () => Promise<unknown>;
};

type DiscordAttachmentLike = {
  id: string;
  url: string;
  name?: string | null;
  contentType?: string | null;
  size?: number;
};

type DiscordMessageLike = {
  id: string;
  channelId: string;
  author: {
    id: string;
    bot?: boolean;
    username: string;
    globalName?: string | null;
  };
  content: string;
  attachments: Collection<string, DiscordAttachmentLike> | DiscordAttachmentLike[];
  guild: unknown | null;
  createdTimestamp: number;
};

const DISCORD_TEXT_LIMIT = 2000;
const DISCORD_FILE_LIMIT = 10 * 1024 * 1024;

export function isDiscordAllowed(userId: string, allowlist: Set<string>): boolean {
  // Empty allowlist is dev/initial setup only. Production must set family userIds.
  return allowlist.size === 0 || allowlist.has(userId);
}

export function splitDiscordText(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const codePoint of text) {
    if (current.length + codePoint.length > DISCORD_TEXT_LIMIT) {
      chunks.push(current);
      current = "";
    }
    current += codePoint;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function toIncoming(message: DiscordMessageLike): IncomingMsg {
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
    : Array.from(message.attachments.values());
  const files = attachments.map((attachment) => ({
    id: attachment.url,
    fileName: attachment.name ?? attachment.id,
    mimeType: attachment.contentType ?? undefined,
  }));
  const content = message.content || null;

  return {
    chatId: message.channelId,
    userId: message.author.id,
    userName: message.author.globalName ?? message.author.username,
    text: files.length === 0 ? content : null,
    caption: files.length > 0 ? content : null,
    files,
    voice: null,
    isGroup: message.guild != null,
    date: Math.floor(message.createdTimestamp / 1000),
    raw: {
      id: message.id,
      channelId: message.channelId,
      author: {
        id: message.author.id,
        username: message.author.username,
        globalName: message.author.globalName ?? null,
      },
      content: message.content,
      createdTimestamp: message.createdTimestamp,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        url: attachment.url,
        name: attachment.name ?? null,
        contentType: attachment.contentType ?? null,
        size: attachment.size ?? null,
      })),
    },
    platform: "discord",
  };
}

export class DiscordMessenger implements Messenger {
  private client: Client;
  private allowlist: Set<string>;

  constructor(private token: string, allowlist: string[]) {
    this.allowlist = new Set(allowlist);
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });
  }

  onMessage(handler: MessageHandler): void {
    this.client.on("messageCreate", async (message: Message) => {
      if (message.author.bot) return;
      if (!this.isAllowed(message.author.id)) {
        console.log(`[discord] ignored message from non-allowlisted user ${message.author.id}`);
        return;
      }
      await handler(toIncoming(message as unknown as DiscordMessageLike));
    });
  }

  isAllowed(userId: string): boolean {
    return isDiscordAllowed(userId, this.allowlist);
  }

  async sendText(chatId: string, text: string): Promise<void> {
    const channel = await this.fetchSendableChannel(chatId);
    for (const chunk of splitDiscordText(text)) {
      await channel.send(chunk);
    }
  }

  async sendFile(chatId: string, file: OutFile): Promise<void> {
    const data = Buffer.from(file.data);
    if (data.length > DISCORD_FILE_LIMIT) {
      await this.sendText(chatId, `파일이 커서 전송 못 함: ${file.fileName}`);
      return;
    }

    const channel = await this.fetchSendableChannel(chatId);
    const attachment = new AttachmentBuilder(data, { name: file.fileName });
    await channel.send({ files: [attachment] });
  }

  async sendTyping(chatId: string): Promise<void> {
    const channel = await this.fetchSendableChannel(chatId);
    await channel.sendTyping?.().catch(() => {});
  }

  async downloadFile(ref: FileRef): Promise<{ buffer: Buffer; mimeType?: string }> {
    const res = await fetch(ref.id);
    if (!res.ok) throw new Error(`파일 다운로드 실패: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, mimeType: ref.mimeType };
  }

  async start(): Promise<void> {
    await this.client.login(this.token);
  }

  private async fetchSendableChannel(chatId: string): Promise<SendableChannel> {
    const channel = await this.client.channels.fetch(chatId);
    if (!channel || !("send" in channel) || typeof channel.send !== "function") {
      throw new Error("Discord channel is not sendable");
    }
    return channel as unknown as SendableChannel;
  }
}
