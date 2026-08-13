import { config } from "../../config";
import { compatStt } from "../openaiCompat";

export const groqStt = compatStt(() => ({
  apiKey: config.groqKey,
  baseURL: "https://api.groq.com/openai/v1",
}));
