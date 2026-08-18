import { config } from "../../config";
import { compatLlm } from "../openaiCompat";
import type { SttProvider, SttStreamAdapter, TtsProvider } from "../types";

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

// Streaming STT: wss /v1/stt takes raw binary PCM frames (config via query
// params); emits transcript.partial / transcript.done JSON events.
export const xaiSttStream: SttStreamAdapter = {
  inputRate: 16000,
  stream({ onPartial, onFinal, onError }) {
    const ws = new WebSocket("wss://api.x.ai/v1/stt?audio_format=pcm&sample_rate=16000", {
      headers: { Authorization: `Bearer ${config.xaiKey}` },
    } as unknown as string[]);

    const segments: string[] = [];
    let latest = "";
    let finalizePending = false;
    let closedByUs = false;
    const joined = () => [...segments, latest].join(" ").replace(/\s+/g, " ").trim();
    const emitTurn = () => {
      finalizePending = false;
      onFinal(joined());
      segments.length = 0;
      latest = "";
    };

    return new Promise((resolve, reject) => {
      let opened = false;
      ws.addEventListener("open", () => {
        opened = true;
        resolve({
          sendAudio(b64) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(Buffer.from(b64, "base64"));
            }
          },
          finalizeTurn() {
            // "Finalize" forces utterance completion but keeps the stream
            // alive for the next turn (unlike the terminal "audio.done").
            if (ws.readyState === WebSocket.OPEN) {
              finalizePending = true;
              ws.send(JSON.stringify({ type: "Finalize" }));
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
          case "transcript.partial":
            if (event.speech_final) {
              if (event.text) segments.push(event.text);
              latest = "";
              if (finalizePending) {
                emitTurn();
                break;
              }
            } else {
              latest = event.text ?? "";
            }
            onPartial(joined());
            break;
          case "transcript.done":
            if (event.text) {
              segments.length = 0;
              latest = event.text;
            }
            emitTurn();
            break;
          case "error":
            onError(event.message ?? event.error?.message ?? "xAI STT error");
            break;
        }
      });
      ws.addEventListener("close", (evt) => {
        if (!opened) {
          reject(new Error(`xAI STT connection failed (${evt.code}) ${evt.reason ?? ""}`));
        } else if (!closedByUs) {
          onError("xAI STT connection closed unexpectedly");
        }
      });
      ws.addEventListener("error", () => {
        if (!opened) reject(new Error("xAI STT connection error (check API key)"));
      });
    });
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
