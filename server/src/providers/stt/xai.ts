import { config } from "../../config";
import type { SttProvider } from "../types";

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
