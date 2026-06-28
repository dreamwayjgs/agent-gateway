export type Platform = "telegram" | "discord" | "slack";

export interface FileRef {
  id: string; // telegram: file_id. 어댑터가 downloadFile()로 해석
  fileName: string;
  mimeType?: string;
}

export interface IncomingMsg {
  chatId: string; // 항상 string. telegram number → String() 변환
  userId: string | null;
  userName: string | null;
  text: string | null;
  caption: string | null;
  files: FileRef[]; // 사진/문서, 미디어그룹은 여러 개로 합쳐 전달
  voice: FileRef | null;
  isGroup: boolean;
  date: number; // epoch sec
  raw: unknown; // 원본 페이로드 (DB raw 컬럼 저장용)
  platform: Platform;
}

export interface OutFile {
  data: Buffer | Uint8Array;
  fileName: string;
  kind: "animation" | "photo" | "video" | "audio" | "document";
}

// files.ts 등 비-어댑터 모듈이 Messenger 전체에 결합되지 않도록 다운로드 능력만 주입
export type FileDownloader = (ref: FileRef) => Promise<{ buffer: Buffer; mimeType?: string }>;

export interface Messenger {
  onMessage(handler: (msg: IncomingMsg) => Promise<void>): void;
  sendText(chatId: string, text: string): Promise<void>; // 분할은 어댑터 내부
  sendFile(chatId: string, file: OutFile): Promise<void>;
  sendTyping(chatId: string): Promise<void>; // 실패 무시 (.catch)
  downloadFile(ref: FileRef): Promise<{ buffer: Buffer; mimeType?: string }>;
  start(): Promise<void>;
}
