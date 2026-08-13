import { Hono } from "hono";
import { resolve } from "../providers/registry";
import type { ChatMessage } from "../providers/types";

const SYSTEM_PROMPT =
  "You are a helpful voice assistant. Keep replies concise and conversational — they will be read aloud.";

export const llmRoute = new Hono().post("/llm", async (c) => {
  const body = (await c.req.json()) as {
    messages: ChatMessage[];
    provider: string;
    option: string;
  };
  const { impl, option } = resolve("llm", body.provider, body.option);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...body.messages,
  ];
  const t0 = performance.now();
  const text = await impl.chat(messages, option.model);
  return c.json({ text, ms: Math.round(performance.now() - t0) });
});
