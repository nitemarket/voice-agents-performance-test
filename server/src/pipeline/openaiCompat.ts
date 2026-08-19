import OpenAI from "openai";
import type { LlmProvider, SttProvider, TtsProvider } from "./types";

// Factories for providers exposing an OpenAI-compatible API
// (OpenAI itself, xAI chat, Groq, Gemini chat, ...).

interface CompatConfig {
  apiKey: string;
  baseURL?: string;
}

export function compatLlm(cfg: () => CompatConfig): LlmProvider {
  return {
    async chat(messages, model, tools) {
      const client = new OpenAI(cfg());
      const res = await client.chat.completions.create({
        model,
        messages: messages as never,
        ...(tools?.length ? { tools: tools as never } : {}),
      });
      const message = res.choices[0]?.message;
      const toolCalls = (message?.tool_calls ?? [])
        .filter((tc): tc is Extract<typeof tc, { type: "function" }> => tc.type === "function")
        .map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }));
      return {
        text: message?.content ?? "",
        toolCalls: toolCalls.length ? toolCalls : undefined,
      };
    },
    async *chatStream(messages, model, tools) {
      const client = new OpenAI(cfg());
      const stream = await client.chat.completions.create({
        model,
        messages: messages as never,
        stream: true,
        ...(tools?.length ? { tools: tools as never } : {}),
      });
      // Tool-call arguments stream in fragments keyed by index; accumulate
      // and emit them as one event when the stream ends.
      const pending: Record<number, { id: string; name: string; arguments: string }> = {};
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) yield { type: "delta", text: delta.content };
        for (const tc of delta?.tool_calls ?? []) {
          const acc = (pending[tc.index] ??= { id: "", name: "", arguments: "" });
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }
      const calls = Object.values(pending);
      if (calls.length) yield { type: "toolCalls", calls };
    },
  };
}

export function compatStt(cfg: () => CompatConfig): SttProvider {
  return {
    async transcribe(audio, model) {
      const client = new OpenAI(cfg());
      const res = await client.audio.transcriptions.create({ file: audio, model });
      return res.text;
    },
  };
}

export function compatTts(
  cfg: () => CompatConfig,
  format: { responseFormat?: "mp3" | "wav"; mime: string } = { mime: "audio/mpeg" },
): TtsProvider {
  return {
    async speak(text, model, voice) {
      const client = new OpenAI(cfg());
      const res = await client.audio.speech.create({
        model,
        voice,
        input: text,
        ...(format.responseFormat ? { response_format: format.responseFormat } : {}),
      });
      return { audio: await res.arrayBuffer(), mime: format.mime };
    },
  };
}
