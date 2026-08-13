import { config } from "../../config";
import { compatLlm } from "../openaiCompat";

export const groqLlm = compatLlm(() => ({
  apiKey: config.groqKey,
  baseURL: "https://api.groq.com/openai/v1",
}));
