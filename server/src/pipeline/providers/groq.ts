import { config } from "../../config";
import { compatLlm, compatStt, compatTts } from "../openaiCompat";

const groq = () => ({ apiKey: config.groqKey, baseURL: "https://api.groq.com/openai/v1" });

export const groqStt = compatStt(groq);
export const groqLlm = compatLlm(groq);
// Groq TTS (Orpheus) returns WAV by default.
export const groqTts = compatTts(groq, { responseFormat: "wav", mime: "audio/wav" });
