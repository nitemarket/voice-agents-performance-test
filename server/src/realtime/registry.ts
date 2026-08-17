import { config } from "../config";
import type { RealtimeAdapter } from "./types";
import { compatRealtime } from "./openaiCompat";
import { geminiRealtime } from "./gemini";

interface StsProviderEntry {
  id: string;
  label: string;
  envKey: keyof typeof config;
  adapter: RealtimeAdapter;
  models: { id: string; label: string }[];
}

// To add an STS provider: implement RealtimeAdapter in one file, add an entry here.
const providers: StsProviderEntry[] = [
  {
    id: "openai",
    label: "OpenAI",
    envKey: "openaiKey",
    adapter: compatRealtime(() => ({
      url: "wss://api.openai.com/v1/realtime",
      apiKey: config.openaiKey,
      transcriptionModel: "whisper-1",
    })),
    models: [
      { id: "gpt-realtime", label: "GPT Realtime" },
      { id: "gpt-realtime-mini", label: "GPT Realtime mini" },
    ],
  },
  {
    id: "xai",
    label: "xAI Grok",
    envKey: "xaiKey",
    adapter: compatRealtime(() => ({
      url: "wss://api.x.ai/v1/realtime",
      apiKey: config.xaiKey,
    })),
    models: [
      { id: "grok-voice-latest", label: "Grok Voice (latest)" },
      { id: "grok-voice-think-fast-2.0", label: "Grok Voice Think Fast 2.0" },
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    envKey: "geminiKey",
    adapter: geminiRealtime,
    models: [{ id: "gemini-3.1-flash-live-preview", label: "Gemini 3.1 Flash Live" }],
  },
];

function available() {
  return providers.filter((p) => Boolean(config[p.envKey]));
}

export function stsCatalog() {
  return available().map(({ id, label, models }) => ({ id, label, models }));
}

export function resolveSts(providerId: string) {
  const entry = available().find((p) => p.id === providerId);
  if (!entry) throw new Error(`Unknown or unconfigured STS provider: ${providerId}`);
  return entry;
}
