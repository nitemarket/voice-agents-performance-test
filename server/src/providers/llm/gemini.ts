import { config } from "../../config";
import { compatLlm } from "../openaiCompat";

// Google's official OpenAI-compatible endpoint for Gemini chat.
export const geminiLlm = compatLlm(() => ({
  apiKey: config.geminiKey,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
}));
