import OpenAI from "openai";
import type { LlmProvider, SttProvider, TtsProvider } from "./types";

// Factories for providers exposing an OpenAI-compatible API
// (OpenAI itself, xAI chat, Groq, Gemini chat, ...).

interface CompatConfig {
  apiKey: string;
  baseURL?: string;
}

export function compatLlm(cfg: () => CompatConfig): LlmProvider {
  return {
    async chat(messages, model) {
      const client = new OpenAI(cfg());
      const res = await client.chat.completions.create({ model, messages });
      return res.choices[0]?.message?.content ?? "";
    },
  };
}

export function compatStt(cfg: () => CompatConfig): SttProvider {
  return {
    async transcribe(audio, model) {
      const client = new OpenAI(cfg());
      const res = await client.audio.transcriptions.create({ file: audio, model });
      return res.text;
    },
  };
}

export function compatTts(
  cfg: () => CompatConfig,
  format: { responseFormat?: "mp3" | "wav"; mime: string } = { mime: "audio/mpeg" },
): TtsProvider {
  return {
    async speak(text, model, voice) {
      const client = new OpenAI(cfg());
      const res = await client.audio.speech.create({
        model,
        voice,
        input: text,
        ...(format.responseFormat ? { response_format: format.responseFormat } : {}),
      });
      return { audio: await res.arrayBuffer(), mime: format.mime };
    },
  };
}
