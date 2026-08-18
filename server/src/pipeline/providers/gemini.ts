import { config } from "../../config";
import { compatLlm } from "../openaiCompat";
import { pcmToWav } from "../audio";
import type { TtsProvider } from "../types";

// Google's official OpenAI-compatible endpoint for Gemini chat.
export const geminiLlm = compatLlm(() => ({
  apiKey: config.geminiKey,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
}));

// Gemini TTS returns raw 16-bit mono PCM at 24 kHz (base64), wrapped via pcmToWav.
export const geminiTts: TtsProvider = {
  async speak(text, model, voice) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": config.geminiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`Gemini TTS ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
    };
    const b64 = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64) throw new Error("Gemini TTS returned no audio");
    return { audio: pcmToWav(Buffer.from(b64, "base64")), mime: "audio/wav" };
  },
};
