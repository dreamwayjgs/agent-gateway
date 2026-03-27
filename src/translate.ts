import { getDb } from "./db";

const TRANSLATE_MODEL = "gemini-2.0-flash";

const LANG_NAMES: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  zh: "Chinese (Simplified)",
  es: "Spanish",
  fr: "French",
  de: "German",
};

export const LANG_LABELS: Record<string, string> = {
  en: "영어",
  ja: "일본어",
  zh: "중국어",
  es: "스페인어",
  fr: "프랑스어",
  de: "독일어",
};

export type TranslateResult = {
  transcript: string;
  translation: string;
  detectedLang: string;
};

export async function transcribeAndTranslate(
  audioPath: string,
  targetLang: string,
  apiKey: string
): Promise<TranslateResult> {
  const audioBytes = await Bun.file(audioPath).bytes();
  const base64Audio = Buffer.from(audioBytes).toString("base64");
  const targetLangName = LANG_NAMES[targetLang] ?? targetLang;

  const prompt = `You are a transcription and translation assistant.
Listen to this audio and:
1. Transcribe it exactly as spoken.
2. Detect whether the language is Korean or ${targetLangName}.
3. If Korean → translate to ${targetLangName}.
4. If ${targetLangName} → translate to Korean.

Respond ONLY in this exact JSON format (no markdown, no extra text):
{"transcript":"<original text>","translation":"<translated text>","detectedLang":"<ko or ${targetLang}>"}`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "audio/ogg", data: base64Audio } },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json" },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TRANSLATE_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini API returned empty response");

  return JSON.parse(text) as TranslateResult;
}

export function saveVoiceLog(
  chatId: number,
  fileId: string,
  localPath: string,
  result: TranslateResult,
  targetLang: string
): void {
  getDb().run(
    `INSERT INTO voice_logs (chat_id, file_id, local_path, transcript, translation, target_lang, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [chatId, fileId, localPath, result.transcript, result.translation, targetLang, Math.floor(Date.now() / 1000)]
  );
}
