import { config } from "../../config";
import { compatLlm } from "../openaiCompat";

// xAI chat completions are OpenAI-compatible.
export const xaiLlm = compatLlm(() => ({
  apiKey: config.xaiKey,
  baseURL: "https://api.x.ai/v1",
}));
