import { config } from "../config";
import type { LlmProvider, SttProvider, SttStreamAdapter, TtsProvider } from "./types";
import { openaiLlm, openaiStt, openaiSttStream, openaiTts } from "./providers/openai";
import { xaiLlm, xaiStt, xaiSttStream, xaiTts } from "./providers/xai";
import { groqLlm, groqStt, groqTts } from "./providers/groq";
import { geminiLlm, geminiTts } from "./providers/gemini";
import { elevenlabsStt, elevenlabsSttStream, elevenlabsTts } from "./providers/elevenlabs";
import { batchAsSttStream } from "./batchSttStream";

export type Stage = "stt" | "llm" | "tts";

export interface StageOption {
  id: string; // model id (stt/llm) or "model/voice" pair id (tts)
  label: string;
  model: string;
  voice?: string;
}

interface ProviderEntry<T> {
  id: string;
  label: string;
  envKey: keyof typeof config;
  impl: T;
  options: StageOption[];
  /** STT only: realtime transcription support (adapter + the model it uses). */
  stream?: { adapter: SttStreamAdapter; model: string };
}

// To add a provider: write one file implementing the stage interface, then add an entry here.
const stt: ProviderEntry<SttProvider>[] = [
  {
    id: "openai",
    label: "OpenAI",
    envKey: "openaiKey",
    impl: openaiStt,
    stream: { adapter: openaiSttStream, model: "gpt-live-transcribe" },
    options: [
      { id: "gpt-4o-transcribe", label: "GPT-4o Transcribe", model: "gpt-4o-transcribe" },
      { id: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe", model: "gpt-4o-mini-transcribe" },
      { id: "whisper-1", label: "Whisper", model: "whisper-1" },
    ],
  },
  {
    id: "xai",
    label: "xAI Grok",
    envKey: "xaiKey",
    impl: xaiStt,
    stream: { adapter: xaiSttStream, model: "grok-stt" },
    options: [{ id: "grok-stt", label: "Grok STT", model: "grok-stt" }],
  },
  {
    id: "groq",
    label: "Groq",
    envKey: "groqKey",
    impl: groqStt,
    // No realtime API — VAD-segmented batch: buffer the turn, one fast batch call on commit.
    stream: { adapter: batchAsSttStream(groqStt), model: "whisper-large-v3-turbo" },
    options: [
      { id: "whisper-large-v3-turbo", label: "Whisper Large v3 Turbo", model: "whisper-large-v3-turbo" },
      { id: "whisper-large-v3", label: "Whisper Large v3", model: "whisper-large-v3" },
    ],
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    envKey: "elevenKey",
    impl: elevenlabsStt,
    stream: { adapter: elevenlabsSttStream, model: "scribe_v2_realtime" },
    options: [{ id: "scribe_v2", label: "Scribe v2", model: "scribe_v2" }],
  },
];

const llm: ProviderEntry<LlmProvider>[] = [
  {
    id: "openai",
    label: "OpenAI",
    envKey: "openaiKey",
    impl: openaiLlm,
    options: [
      { id: "gpt-5.5", label: "GPT-5.5", model: "gpt-5.5" },
      { id: "gpt-5.2-mini", label: "GPT-5.2 mini", model: "gpt-5.2-mini" },
    ],
  },
  {
    id: "xai",
    label: "xAI Grok",
    envKey: "xaiKey",
    impl: xaiLlm,
    options: [
      { id: "grok-4.6", label: "Grok 4.6", model: "grok-4.6" },
      { id: "grok-build-0.1", label: "Grok Build 0.1", model: "grok-build-0.1" },
    ],
  },
  {
    id: "groq",
    label: "Groq",
    envKey: "groqKey",
    impl: groqLlm,
    options: [
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", model: "openai/gpt-oss-120b" },
      { id: "qwen/qwen3.6-27b", label: "Qwen 3.6 27B", model: "qwen/qwen3.6-27b" },
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    envKey: "geminiKey",
    impl: geminiLlm,
    options: [
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", model: "gemini-3.6-flash" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", model: "gemini-3.5-flash-lite" },
    ],
  },
];

const tts: ProviderEntry<TtsProvider>[] = [
  {
    id: "openai",
    label: "OpenAI",
    envKey: "openaiKey",
    impl: openaiTts,
    options: [
      { id: "gpt-4o-mini-tts/alloy", label: "Alloy", model: "gpt-4o-mini-tts", voice: "alloy" },
      { id: "gpt-4o-mini-tts/nova", label: "Nova", model: "gpt-4o-mini-tts", voice: "nova" },
      { id: "gpt-4o-mini-tts/onyx", label: "Onyx", model: "gpt-4o-mini-tts", voice: "onyx" },
    ],
  },
  {
    id: "xai",
    label: "xAI Grok",
    envKey: "xaiKey",
    impl: xaiTts,
    options: [{ id: "grok-tts/eve", label: "Eve", model: "grok-tts", voice: "eve" }],
  },
  {
    id: "groq",
    label: "Groq",
    envKey: "groqKey",
    impl: groqTts,
    options: [
      { id: "orpheus/hannah", label: "Orpheus — Hannah", model: "canopylabs/orpheus-v1-english", voice: "hannah" },
      { id: "orpheus/troy", label: "Orpheus — Troy", model: "canopylabs/orpheus-v1-english", voice: "troy" },
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    envKey: "geminiKey",
    impl: geminiTts,
    options: [
      { id: "gemini-tts/kore", label: "Gemini TTS — Kore", model: "gemini-2.5-flash-preview-tts", voice: "Kore" },
      { id: "gemini-tts/puck", label: "Gemini TTS — Puck", model: "gemini-2.5-flash-preview-tts", voice: "Puck" },
    ],
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    envKey: "elevenKey",
    impl: elevenlabsTts,
    options: [
      { id: "flash-v2.5/rachel", label: "Flash v2.5 — Rachel", model: "eleven_flash_v2_5", voice: "21m00Tcm4TlvDq8ikWAM" },
      { id: "multilingual-v2/adam", label: "Multilingual v2 — Adam", model: "eleven_multilingual_v2", voice: "pNInz6obpgDQGcFmaJgB" },
    ],
  },
];

interface StageImpls {
  stt: SttProvider;
  llm: LlmProvider;
  tts: TtsProvider;
}

const registry: { [S in Stage]: ProviderEntry<StageImpls[S]>[] } = { stt, llm, tts };

function available<T>(entries: ProviderEntry<T>[]) {
  return entries.filter((e) => Boolean(config[e.envKey]));
}

/** Catalog of usable providers (env key present), safe to send to the client. */
export function catalog() {
  const strip = <T,>(entries: ProviderEntry<T>[]) =>
    available(entries).map(({ id, label, options, stream }) => ({
      id,
      label,
      options,
      streaming: Boolean(stream),
    }));
  return { stt: strip(stt), llm: strip(llm), tts: strip(tts) };
}

export function resolveSttStream(providerId: string) {
  const entry = available(stt).find((e) => e.id === providerId);
  if (!entry?.stream) {
    throw new Error(`Provider ${providerId} does not support streaming STT`);
  }
  return entry.stream;
}

export function resolve<S extends Stage>(stage: S, providerId: string, optionId: string) {
  const entries = registry[stage] as ProviderEntry<StageImpls[S]>[];
  const entry = available(entries).find((e) => e.id === providerId);
  if (!entry) throw new Error(`Unknown or unconfigured ${stage} provider: ${providerId}`);
  const option = entry.options.find((o) => o.id === optionId);
  if (!option) throw new Error(`Unknown ${stage} option for ${providerId}: ${optionId}`);
  return { impl: entry.impl, option };
}
