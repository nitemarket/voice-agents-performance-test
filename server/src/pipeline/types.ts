export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SttProvider {
  transcribe(audio: File, model: string): Promise<string>;
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
