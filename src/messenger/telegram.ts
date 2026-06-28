import { Bot, InputFile } from "grammy";
import type { FileRef, IncomingMsg, Messenger, OutFile } from "./types";

type MessageHandler = (msg: IncomingMsg) => Promise<void>;

type MediaGroupBuffer = {
  base: any; // 그룹 첫 메시지 ctx.message (chat/from/date 출처)
  caption: string | null;
  files: FileRef[];
  timer: ReturnType<typeof setTimeout>;
};

export class TelegramMessenger implements Messenger {
  private bot: Bot;
  private token: string;
  private handler: MessageHandler | null = null;
  private mediaGroups = new Map<string, MediaGroupBuffer>();

  constructor(token: string) {
    this.token = token;
    this.bot = new Bot(token);
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
    this.bot.on("message", async (ctx) => {
      const m = ctx.message;

      // 미디어그룹: 첫 항목 기준 고정 500ms 윈도우로 버퍼링 → files[] 합쳐 단일 msg emit
      // (후속 항목은 타이머 재설정 안 함 — 원본 src/index.ts flushMediaGroup 동작 유지)
      const groupId = m.media_group_id as string | undefined;
      if (groupId && (m.photo || m.document)) {
        this.bufferMediaGroup(groupId, m);
        return;
      }

      const msg = this.toIncoming(m);
      if (!msg) return;
      await this.dispatch(msg);
    });
  }

  private bufferMediaGroup(groupId: string, m: any): void {
    const ref = this.fileRefOf(m);
    if (!ref) return;
    const caption = (m.caption as string | undefined) ?? null;

    let buf = this.mediaGroups.get(groupId);
    if (!buf) {
      // 첫 항목 도착 시점에 한 번만 타이머 설정 (고정 윈도우)
      buf = {
        base: m,
        caption: null,
        files: [],
        timer: setTimeout(() => this.flushMediaGroup(groupId), 500),
      };
      this.mediaGroups.set(groupId, buf);
    }
    if (caption) buf.caption = caption;
    buf.files.push(ref);
  }

  private async flushMediaGroup(groupId: string): Promise<void> {
    const buf = this.mediaGroups.get(groupId);
    if (!buf) return;
    this.mediaGroups.delete(groupId);

    const m = buf.base;
    const msg: IncomingMsg = {
      chatId: String(m.chat.id),
      userId: m.from?.id != null ? String(m.from.id) : null,
      userName: m.from?.first_name ?? null,
      text: null,
      caption: buf.caption,
      files: buf.files,
      voice: null,
      isGroup: m.chat.type === "group" || m.chat.type === "supergroup",
      date: m.date,
      raw: m,
      platform: "telegram",
    };
    await this.dispatch(msg);
  }

  // 단일 메시지 → IncomingMsg. 처리 대상 아니면 null
  private toIncoming(m: any): IncomingMsg | null {
    const base = {
      chatId: String(m.chat.id),
      userId: m.from?.id != null ? String(m.from.id) : null,
      userName: m.from?.first_name ?? null,
      caption: (m.caption as string | undefined) ?? null,
      isGroup: m.chat.type === "group" || m.chat.type === "supergroup",
      date: m.date,
      raw: m,
      platform: "telegram" as const,
    };

    if (m.text) {
      return { ...base, text: m.text, files: [], voice: null };
    }
    if (m.voice) {
      return {
        ...base,
        text: null,
        files: [],
        voice: { id: m.voice.file_id, fileName: `${m.date}_voice.ogg`, mimeType: m.voice.mime_type },
      };
    }
    if (m.photo || m.document) {
      const ref = this.fileRefOf(m);
      if (!ref) return null;
      return { ...base, text: null, files: [ref], voice: null };
    }
    return null;
  }

  private fileRefOf(m: any): FileRef | null {
    if (m.document) {
      const doc = m.document;
      return { id: doc.file_id, fileName: doc.file_name ?? `file_${m.date}`, mimeType: doc.mime_type };
    }
    if (m.photo) {
      const photo = m.photo.at(-1); // 가장 큰 사이즈
      if (!photo) return null;
      return { id: photo.file_id, fileName: `photo_${m.date}.jpg`, mimeType: "image/jpeg" };
    }
    return null;
  }

  private async dispatch(msg: IncomingMsg): Promise<void> {
    if (!this.handler) return;
    await this.handler(msg);
  }

  async sendText(chatId: string, text: string): Promise<void> {
    const chunks = text.match(/[\s\S]{1,4096}/g) ?? [];
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(chatId, chunk);
    }
  }

  async sendFile(chatId: string, file: OutFile): Promise<void> {
    const input = new InputFile(file.data, file.fileName);
    switch (file.kind) {
      case "animation":
        await this.bot.api.sendAnimation(chatId, input);
        break;
      case "photo":
        await this.bot.api.sendPhoto(chatId, input);
        break;
      case "video":
        await this.bot.api.sendVideo(chatId, input);
        break;
      case "audio":
        await this.bot.api.sendAudio(chatId, input);
        break;
      default:
        await this.bot.api.sendDocument(chatId, input);
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    await this.bot.api.sendChatAction(chatId, "typing").catch(() => {});
  }

  async downloadFile(ref: FileRef): Promise<{ buffer: Buffer; mimeType?: string }> {
    const tgFile = await this.bot.api.getFile(ref.id);
    if (!tgFile.file_path) throw new Error("file_path not available");
    const url = `https://api.telegram.org/file/bot${this.token}/${tgFile.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`파일 다운로드 실패: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, mimeType: ref.mimeType };
  }

  async start(): Promise<void> {
    this.bot.start();
  }
}
