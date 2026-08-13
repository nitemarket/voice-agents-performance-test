import { config } from "../../config";
import type { TtsProvider } from "../types";

// https://docs.x.ai — POST /v1/tts with { text, voice_id, language }; responds with raw audio bytes.
// The endpoint has a single TTS engine, so `model` is unused.
export const xaiTts: TtsProvider = {
  async speak(text, _model, voice) {
    const res = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.xaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, voice_id: voice, language: "auto" }),
    });
    if (!res.ok) {
      throw new Error(`xAI TTS ${res.status}: ${await res.text()}`);
    }
    const mime = res.headers.get("content-type") ?? "audio/mpeg";
    return { audio: await res.arrayBuffer(), mime };
  },
};
