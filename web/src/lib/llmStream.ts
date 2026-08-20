import type { ChatMessage, Selection } from "./api";
import { authHeaders } from "./auth";

export type LlmStreamEvent =
  | { delta: string }
  | { tool: { id: string; name: string; status: "running" | "done"; args?: string } }
  | { done: true; ms: number }
  | { error: string };

/** POST /api/llm/stream and yield parsed SSE events. */
export async function* streamChat(
  messages: ChatMessage[],
  sel: Selection,
  signal?: AbortSignal,
): AsyncGenerator<LlmStreamEvent> {
  const res = await fetch("/api/llm/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ messages, ...sel }),
    signal,
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
 * Cut the first speakable chunk early, at a clause boundary, so TTS can start
 * before the first full sentence completes. Only used before any audio has
 * been queued; requires ≥24 chars so we don't synthesize a bare "Sure,".
 */
export function eagerFirstCut(text: string): { head: string; rest: string } | null {
  // Scan ALL clause boundaries and take the first one far enough in — replies
  // often open with an early comma ("One moment, ...") that is too short to
  // speak on its own.
  const re = /[,;:—]\s/g;
  let match;
  while ((match = re.exec(text))) {
    if (match.index + 1 >= 20) {
      const end = match.index + match[0].length;
      return { head: text.slice(0, end).trim(), rest: text.slice(end) };
    }
  }
  return null;
}

/** Make streamed text TTS-friendly: strip markdown emphasis, headings, bullets. */
export function toSpeakable(text: string): string {
  return text
    .replace(/\*\*|__|`+/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
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
