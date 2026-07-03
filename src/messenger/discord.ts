import {
  AttachmentBuilder,
  Client,
  GatewayIntentBits,
  Partials,
  type Collection,
  type Message,
} from "discord.js";
import {
  addAllow,
  adminCommandUsage,
  isAdminCommandText,
  isFamilyAllowed,
  listAllow,
  parseAdminCommand,
  removeAllow,
} from "./discord-allowlist";
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
  guild: { name?: string | null } | null;
  createdTimestamp: number;
};

const DISCORD_TEXT_LIMIT = 2000;
const DISCORD_FILE_LIMIT = 10 * 1024 * 1024;

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
  readonly platform = "discord" as const;
  private client: Client;
  private notifiedUnknown = new Set<string>();
  private warnedMissingAdmin = false;
  private maxNotifiedUnknown = 1000;

  constructor(private token: string, private adminId: string) {
    if (!adminId) this.warnMissingAdmin();
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
      if (message.author.id === this.adminId && await this.handleAdminCommand(message as unknown as DiscordMessageLike)) {
        return;
      }
      if (!this.isAllowed(message.author.id)) {
        await this.notifyAdminUnknownUser(message as unknown as DiscordMessageLike);
        return;
      }
      await handler(toIncoming(message as unknown as DiscordMessageLike));
    });
  }

  isAllowed(userId: string): boolean {
    return isFamilyAllowed(userId, this.adminId);
  }

  private async handleAdminCommand(message: DiscordMessageLike): Promise<boolean> {
    if (!isAdminCommandText(message.content)) return false;
    if (message.guild != null) {
      await this.sendText(message.channelId, "관리자 명령은 나와의 DM에서만 사용할 수 있어요.");
      return true;
    }

    const command = parseAdminCommand(message.content);
    if (!command) {
      await this.sendText(message.channelId, adminCommandUsage());
      return true;
    }

    if (command.cmd === "allow") {
      addAllow(command.userId, command.name);
      await this.sendText(message.channelId, `허용 완료: ${command.userId}${command.name ? ` (${command.name})` : ""}`);
      return true;
    }
    if (command.cmd === "block") {
      removeAllow(command.userId);
      await this.sendText(message.channelId, `차단 완료: ${command.userId}`);
      return true;
    }

    const rows = listAllow();
    const body = rows.length === 0
      ? "등록된 가족 없음"
      : rows.map((row) => `- ${row.user_id}${row.name ? ` (${row.name})` : ""}`).join("\n");
    await this.sendText(message.channelId, body);
    return true;
  }

  private async notifyAdminUnknownUser(message: DiscordMessageLike): Promise<void> {
    const userId = message.author.id;
    if (this.notifiedUnknown.has(userId)) return;

    if (!this.adminId) {
      this.warnMissingAdmin();
      return;
    }

    const userName = message.author.globalName ?? message.author.username;
    const context = message.guild?.name ?? "DM";
    const text = `⚠️ 미등록 사용자 ${userName}(\`${userId}\`)가 ${context}에서 접촉. 허용: \`!허용 ${userId} ${userName}\``;
    try {
      const admin = await this.client.users.fetch(this.adminId);
      await admin.send(text);
      if (this.notifiedUnknown.size >= this.maxNotifiedUnknown) {
        const oldest = this.notifiedUnknown.values().next().value;
        if (oldest) this.notifiedUnknown.delete(oldest);
      }
      this.notifiedUnknown.add(userId);
    } catch (err) {
      console.log(`[discord] failed to notify admin for unknown user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private warnMissingAdmin(): void {
    if (this.warnedMissingAdmin) return;
    this.warnedMissingAdmin = true;
    console.warn("DISCORD_ADMIN_USER_ID 미설정 — 관리자 온보딩 불가, admin 통과·알림 없음");
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
    if (!this.adminId) this.warnMissingAdmin();
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
