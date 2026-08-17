import { config } from "../../config";
import { compatLlm } from "../openaiCompat";
import type { SttProvider, TtsProvider } from "../types";

// xAI chat completions are OpenAI-compatible; STT/TTS use xAI's own endpoints.
export const xaiLlm = compatLlm(() => ({
  apiKey: config.xaiKey,
  baseURL: "https://api.x.ai/v1",
}));

// https://docs.x.ai — POST /v1/stt, multipart form; the `file` field must come last.
// The endpoint has a single STT model, so `model` is unused.
export const xaiStt: SttProvider = {
  async transcribe(audio, _model) {
    const form = new FormData();
    form.append("file", audio);
    const res = await fetch("https://api.x.ai/v1/stt", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.xaiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`xAI STT ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { text: string };
    return json.text;
  },
};

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
