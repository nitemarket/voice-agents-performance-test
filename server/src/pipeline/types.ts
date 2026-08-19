export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  // assistant messages replaying a tool round / tool result messages
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

export interface LlmResult {
  text: string;
  toolCalls?: LlmToolCall[];
}

export type LlmStreamItem =
  | { type: "delta"; text: string }
  | { type: "toolCalls"; calls: LlmToolCall[] };

export interface SttProvider {
  transcribe(audio: File, model: string): Promise<string>;
}

// Streaming STT: audio chunks go to the provider while the user is still
// speaking; partials stream back. The session is long-lived and multi-turn:
// finalizeTurn() commits the current utterance (onFinal fires with its text)
// and the session keeps listening for the next turn.
export interface SttStreamSession {
  sendAudio(b64: string): void; // base64 PCM16 at inputRate
  finalizeTurn(): void;
  close(): void;
}

export interface SttStreamAdapter {
  inputRate: number;
  stream(opts: {
    model: string;
    onPartial: (text: string) => void;
    onFinal: (text: string) => void; // per turn; partial state resets after
    onError: (message: string) => void;
  }): Promise<SttStreamSession>;
}

export interface LlmProvider {
  chat(messages: ChatMessage[], model: string, tools?: ToolSpec[]): Promise<LlmResult>;
  chatStream(messages: ChatMessage[], model: string, tools?: ToolSpec[]): AsyncIterable<LlmStreamItem>;
}

export interface TtsResult {
  audio: ArrayBuffer;
  mime: string;
}

export interface TtsProvider {
  speak(text: string, model: string, voice: string): Promise<TtsResult>;
}
