import { config } from "../../config";
import type { SttProvider, SttStreamAdapter, TtsProvider } from "../types";

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

// Scribe v2 Realtime: wss /v1/speech-to-text/realtime with manual commit
// strategy. Audio goes as base64 chunks; the turn-commit flag rides on the
// next mic chunk (the mic streams continuously, so it lands within ~150ms).
export const elevenlabsSttStream: SttStreamAdapter = {
  inputRate: 16000,
  stream({ model, onPartial, onFinal, onError }) {
    const ws = new WebSocket(
      `wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=${encodeURIComponent(model)}&audio_format=pcm_16000&commit_strategy=manual`,
      { headers: { "xi-api-key": config.elevenKey } } as unknown as string[],
    );

    let commitNext = false;
    let closedByUs = false;

    return new Promise((resolve, reject) => {
      let started = false;
      ws.addEventListener("message", (evt) => {
        let event: any;
        try {
          event = JSON.parse(String(evt.data));
        } catch {
          return;
        }
        switch (event.message_type) {
          case "session_started":
            started = true;
            resolve({
              sendAudio(b64) {
                if (ws.readyState === WebSocket.OPEN) {
                  const commit = commitNext;
                  commitNext = false;
                  ws.send(
                    JSON.stringify({
                      message_type: "input_audio_chunk",
                      audio_base_64: b64,
                      commit,
                    }),
                  );
                }
              },
              finalizeTurn() {
                commitNext = true;
              },
              close() {
                closedByUs = true;
                ws.close();
              },
            });
            break;
          case "partial_transcript":
            onPartial(event.text ?? "");
            break;
          case "committed_transcript":
          case "committed_transcript_with_timestamps":
            onFinal(event.text ?? "");
            break;
          default:
            if (typeof event.message_type === "string" && event.message_type.includes("error")) {
              const message = event.error ?? event.message_type;
              if (started) {
                onError(message);
              } else {
                reject(new Error(`ElevenLabs realtime STT: ${message}`));
                ws.close();
              }
            }
        }
      });
      ws.addEventListener("close", (evt) => {
        if (!started) {
          reject(new Error(`ElevenLabs realtime STT connection failed (${evt.code}) ${evt.reason ?? ""}`));
        } else if (!closedByUs) {
          onError("ElevenLabs STT connection closed unexpectedly");
        }
      });
      ws.addEventListener("error", () => {
        if (!started) reject(new Error("ElevenLabs realtime STT connection error"));
      });
    });
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
