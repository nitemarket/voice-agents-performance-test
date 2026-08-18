export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

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
  chat(messages: ChatMessage[], model: string): Promise<string>;
  chatStream(messages: ChatMessage[], model: string): AsyncIterable<string>;
}

export interface TtsResult {
  audio: ArrayBuffer;
  mime: string;
}

export interface TtsProvider {
  speak(text: string, model: string, voice: string): Promise<TtsResult>;
}
