import { config } from "../../config";
import type { TtsProvider } from "../types";

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
