import { config } from "../../config";
import type { SttProvider, TtsProvider } from "../types";

// https://elevenlabs.io/docs — POST /v1/speech-to-text, multipart with model_id + file.
export const elevenlabsStt: SttProvider = {
  async transcribe(audio, model) {
    const form = new FormData();
    form.append("model_id", model);
    form.append("file", audio);
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": config.elevenKey },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`ElevenLabs STT ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { text: string };
    return json.text;
  },
};

// https://elevenlabs.io/docs — POST /v1/text-to-speech/{voice_id}; responds with MP3 bytes.
export const elevenlabsTts: TtsProvider = {
  async speak(text, model, voice) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, model_id: model }),
    });
    if (!res.ok) {
      throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text()}`);
    }
    return { audio: await res.arrayBuffer(), mime: "audio/mpeg" };
  },
};
