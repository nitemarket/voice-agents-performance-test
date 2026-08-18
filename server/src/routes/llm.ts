import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { resolve } from "../pipeline/registry";
import type { ChatMessage } from "../pipeline/types";

const SYSTEM_PROMPT =
  "You are a helpful voice assistant. Keep replies concise and conversational — they will be read aloud.";

interface LlmBody {
  messages: ChatMessage[];
  provider: string;
  option: string;
}

function withSystem(messages: ChatMessage[]): ChatMessage[] {
  return [{ role: "system", content: SYSTEM_PROMPT }, ...messages];
}

export const llmRoute = new Hono()
  .post("/llm", async (c) => {
    const body = (await c.req.json()) as LlmBody;
    const { impl, option } = resolve("llm", body.provider, body.option);
    const t0 = performance.now();
    const text = await impl.chat(withSystem(body.messages), option.model);
    return c.json({ text, ms: Math.round(performance.now() - t0) });
  })
  // Streaming variant: SSE events of {delta} tokens, then a final {done, ms}.
  .post("/llm/stream", async (c) => {
    const body = (await c.req.json()) as LlmBody;
    const { impl, option } = resolve("llm", body.provider, body.option);
    return streamSSE(c, async (stream) => {
      const t0 = performance.now();
      try {
        for await (const delta of impl.chatStream(withSystem(body.messages), option.model)) {
          await stream.writeSSE({ data: JSON.stringify({ delta }) });
        }
        await stream.writeSSE({
          data: JSON.stringify({ done: true, ms: Math.round(performance.now() - t0) }),
        });
      } catch (err) {
        await stream.writeSSE({
          data: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        });
      }
    });
  });
