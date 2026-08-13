import { config } from "../../config";
import { compatTts } from "../openaiCompat";

// Groq TTS (Orpheus) returns WAV by default.
export const groqTts = compatTts(
  () => ({ apiKey: config.groqKey, baseURL: "https://api.groq.com/openai/v1" }),
  { responseFormat: "wav", mime: "audio/wav" },
);
