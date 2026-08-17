import type { ToolDef } from "../tools/types";

// Messages sent from our server to the browser over the STS WebSocket.
export type ServerMsg =
  | { type: "ready"; inputRate: number; outputRate: number; tools: string[] }
  | { type: "audio"; data: string } // base64 PCM16 at outputRate
  | { type: "interrupted" } // user barge-in: client should flush its playback queue
  | { type: "transcript"; role: "user" | "agent"; text: string; final: boolean }
  | { type: "tool"; callId: string; name: string; status: "running" | "done"; args?: string }
  | { type: "error"; message: string }
  | { type: "closed" };

export interface RealtimeSession {
  sendAudio(b64: string): void; // base64 PCM16 at inputRate
  close(): void;
}

export interface RealtimeAdapter {
  inputRate: number;
  outputRate: number;
  createSession(opts: {
    model: string;
    instructions: string;
    tools: ToolDef[];
    client: (msg: ServerMsg) => void;
  }): Promise<RealtimeSession>;
}

export type { ToolDef };
