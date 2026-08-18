import { config } from "../../config";
import { compatLlm, compatStt, compatTts } from "../openaiCompat";
import type { SttStreamAdapter } from "../types";

export const openaiStt = compatStt(() => ({ apiKey: config.openaiKey }));
export const openaiLlm = compatLlm(() => ({ apiKey: config.openaiKey }));
export const openaiTts = compatTts(() => ({ apiKey: config.openaiKey }));

// Streaming STT via the Realtime API's transcription-only mode:
// PCM16 @ 24 kHz in, transcript deltas out, manual commit on end.
export const openaiSttStream: SttStreamAdapter = {
  inputRate: 24000,
  stream({ model, onPartial, onFinal, onError }) {
    const ws = new WebSocket("wss://api.openai.com/v1/realtime?intent=transcription", {
      headers: { Authorization: `Bearer ${config.openaiKey}` },
    } as unknown as string[]);

    let partial = "";
    let closedByUs = false;

    return new Promise((resolve, reject) => {
      let opened = false;
      ws.addEventListener("open", () => {
        opened = true;
        ws.send(
          JSON.stringify({
            type: "session.update",
            session: {
              type: "transcription",
              audio: {
                input: {
                  format: { type: "audio/pcm", rate: 24000 },
                  transcription: { model },
                  turn_detection: null,
                },
              },
            },
          }),
        );
        resolve({
          sendAudio(b64) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
            }
          },
          finalizeTurn() {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
            }
          },
          close() {
            closedByUs = true;
            ws.close();
          },
        });
      });
      ws.addEventListener("message", (evt) => {
        let event: any;
        try {
          event = JSON.parse(String(evt.data));
        } catch {
          return;
        }
        switch (event.type) {
          case "conversation.item.input_audio_transcription.delta":
            partial += event.delta ?? "";
            onPartial(partial);
            break;
          case "conversation.item.input_audio_transcription.completed":
            onFinal(event.transcript ?? partial);
            partial = ""; // multi-turn session: reset for the next utterance
            break;
          case "error":
            onError(event.error?.message ?? "Transcription error");
            break;
        }
      });
      ws.addEventListener("close", (evt) => {
        if (!opened) {
          reject(new Error(`OpenAI transcription connection failed (${evt.code})`));
        } else if (!closedByUs) {
          onError("Transcription connection closed unexpectedly");
        }
      });
      ws.addEventListener("error", () => {
        if (!opened) reject(new Error("OpenAI transcription connection error"));
      });
    });
  },
};
