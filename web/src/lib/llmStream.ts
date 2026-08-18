import type { ChatMessage, Selection } from "./api";

export type LlmStreamEvent =
  | { delta: string }
  | { done: true; ms: number }
  | { error: string };

/** POST /api/llm/stream and yield parsed SSE events. */
export async function* streamChat(
  messages: ChatMessage[],
  sel: Selection,
): AsyncGenerator<LlmStreamEvent> {
  const res = await fetch("/api/llm/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, ...sel }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`LLM stream failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE events are separated by a blank line.
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      for (const line of event.split("\n")) {
        if (line.startsWith("data: ")) {
          yield JSON.parse(line.slice(6)) as LlmStreamEvent;
        }
      }
    }
  }
}

/**
 * Pull complete sentences off a growing text buffer, leaving the incomplete
 * tail. Requires whitespace (or end-of-buffer via flush) after the punctuation
 * so decimals like "1.5" don't split.
 */
export function extractSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  for (;;) {
    const match = rest.match(/[.!?…]+\s/);
    if (!match || match.index === undefined) break;
    const end = match.index + match[0].length;
    const sentence = rest.slice(0, end).trim();
    if (sentence) sentences.push(sentence);
    rest = rest.slice(end);
  }
  return { sentences, rest };
}
