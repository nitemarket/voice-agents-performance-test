import { config } from "../../config";
import type { SttProvider } from "../types";

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
