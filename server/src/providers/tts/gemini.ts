import { config } from "../../config";
import type { TtsProvider } from "../types";

// Gemini TTS returns raw 16-bit mono PCM at 24 kHz (base64), so wrap it in a WAV header.
function pcmToWav(pcm: Uint8Array, sampleRate = 24000, channels = 1, bitsPerSample = 16): ArrayBuffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  writeString(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out.buffer;
}

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
