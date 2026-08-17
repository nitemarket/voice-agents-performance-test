import type { RealtimeAdapter, ServerMsg } from "./types";

// Adapter for OpenAI's Realtime API and compatible endpoints (xAI Grok).
// Uses PCM16 @ 24 kHz both ways (the protocol default) and provider-side VAD.

interface CompatRealtimeConfig {
  url: string; // e.g. wss://api.openai.com/v1/realtime
  apiKey: string;
  transcriptionModel?: string; // enable user-speech transcription where supported
}

export function compatRealtime(cfg: () => CompatRealtimeConfig): RealtimeAdapter {
  return {
    inputRate: 24000,
    outputRate: 24000,
    createSession({ model, instructions, tools, client }) {
      const { url, apiKey, transcriptionModel } = cfg();
      const ws = new WebSocket(`${url}?model=${encodeURIComponent(model)}`, {
        // Bun extension: custom headers on client WebSockets.
        headers: { Authorization: `Bearer ${apiKey}` },
      } as unknown as string[]);

      let agentText = "";
      let opened = false;

      const runTool = async (item: { name?: string; call_id?: string; arguments?: string }) => {
        const name = item.name ?? "";
        const callId = item.call_id ?? "";
        const tool = tools.find((t) => t.name === name);
        client({ type: "tool", callId, name, status: "running", args: item.arguments });
        let output: unknown;
        try {
          output = tool
            ? await tool.execute(JSON.parse(item.arguments || "{}"))
            : { error: `Unknown tool: ${name}` };
        } catch (err) {
          output = { error: err instanceof Error ? err.message : String(err) };
        }
        client({ type: "tool", callId, name, status: "done" });
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
          }),
        );
        // Ask the model to continue speaking with the tool result.
        ws.send(JSON.stringify({ type: "response.create" }));
      };

      const handle = (raw: unknown) => {
        let event: any;
        try {
          event = JSON.parse(String(raw));
        } catch {
          return;
        }
        const type: string = event.type ?? "";
        switch (type) {
          // Agent audio (GA and legacy event names)
          case "response.output_audio.delta":
          case "response.audio.delta":
            client({ type: "audio", data: event.delta });
            break;
          // User barge-in
          case "input_audio_buffer.speech_started":
            client({ type: "interrupted" });
            break;
          // Agent transcript
          case "response.output_audio_transcript.delta":
          case "response.audio_transcript.delta":
            agentText += event.delta ?? "";
            client({ type: "transcript", role: "agent", text: agentText, final: false });
            break;
          case "response.output_audio_transcript.done":
          case "response.audio_transcript.done":
            client({
              type: "transcript",
              role: "agent",
              text: event.transcript ?? agentText,
              final: true,
            });
            agentText = "";
            break;
          // User transcript (xAI uses ".updated" instead of ".delta"/".completed")
          case "conversation.item.input_audio_transcription.completed":
            client({ type: "transcript", role: "user", text: event.transcript ?? "", final: true });
            break;
          case "conversation.item.input_audio_transcription.delta":
          case "conversation.item.input_audio_transcription.updated":
            if (event.transcript || event.delta) {
              client({
                type: "transcript",
                role: "user",
                text: event.transcript ?? event.delta,
                final: false,
              });
            }
            break;
          // Tool calls arrive as completed function_call output items
          case "response.output_item.done":
            if (event.item?.type === "function_call") {
              void runTool(event.item);
            }
            break;
          case "error":
            client({ type: "error", message: event.error?.message ?? "Realtime API error" });
            break;
        }
      };

      return new Promise((resolve, reject) => {
        ws.addEventListener("open", () => {
          opened = true;
          const session: Record<string, unknown> = { type: "realtime", instructions };
          if (tools.length > 0) {
            session.tools = tools.map(({ name, description, parameters }) => ({
              type: "function",
              name,
              description,
              parameters,
            }));
          }
          if (transcriptionModel) {
            session.audio = { input: { transcription: { model: transcriptionModel } } };
          }
          ws.send(JSON.stringify({ type: "session.update", session }));
          resolve({
            sendAudio(b64) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
              }
            },
            close() {
              ws.close();
            },
          });
        });
        ws.addEventListener("message", (evt) => handle(evt.data));
        ws.addEventListener("close", (evt) => {
          if (!opened) {
            reject(new Error(`Upstream connection failed (${evt.code}) ${evt.reason ?? ""}`));
          } else {
            client({ type: "closed" });
          }
        });
        ws.addEventListener("error", () => {
          if (!opened) reject(new Error("Upstream connection error (check API key)"));
        });
      });
    },
  };
}

export type { ServerMsg };
