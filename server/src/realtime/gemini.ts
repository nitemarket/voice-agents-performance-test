import { config } from "../config";
import type { RealtimeAdapter } from "./types";

// Gemini Live API adapter. Own protocol over WebSocket:
// first message is `setup`, audio in via `realtimeInput` (PCM16 @ 16 kHz),
// audio out via `serverContent.modelTurn.parts[].inlineData` (PCM16 @ 24 kHz).
const GEMINI_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

// Gemini's Schema type uses uppercase enum values ("OBJECT", "STRING", ...).
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
      out[key] = key === "type" && typeof value === "string" ? value.toUpperCase() : toGeminiSchema(value);
    }
    return out;
  }
  return schema;
}

export const geminiRealtime: RealtimeAdapter = {
  inputRate: 16000,
  outputRate: 24000,
  createSession({ model, instructions, tools, client }) {
    const ws = new WebSocket(`${GEMINI_WS_URL}?key=${encodeURIComponent(config.geminiKey)}`);

    let userText = "";
    let agentText = "";
    let opened = false;
    let ready = false;

    const finalizeUser = () => {
      if (userText) {
        client({ type: "transcript", role: "user", text: userText, final: true });
        userText = "";
      }
    };
    const finalizeAgent = () => {
      if (agentText) {
        client({ type: "transcript", role: "agent", text: agentText, final: true });
        agentText = "";
      }
    };

    return new Promise((resolve, reject) => {
      const handle = (raw: unknown) => {
        let msg: any;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (msg.setupComplete !== undefined) {
          ready = true;
          resolve({
            sendAudio(b64) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    realtimeInput: {
                      audio: { data: b64, mimeType: "audio/pcm;rate=16000" },
                    },
                  }),
                );
              }
            },
            close() {
              ws.close();
            },
          });
          return;
        }
        if (msg.toolCall?.functionCalls) {
          void (async () => {
            const responses = [];
            for (const call of msg.toolCall.functionCalls) {
              const name: string = call.name ?? "";
              const callId: string = call.id ?? "";
              const tool = tools.find((t) => t.name === name);
              client({
                type: "tool",
                callId,
                name,
                status: "running",
                args: JSON.stringify(call.args ?? {}),
              });
              let result: unknown;
              try {
                result = tool
                  ? await tool.execute(call.args ?? {})
                  : { error: `Unknown tool: ${name}` };
              } catch (err) {
                result = { error: err instanceof Error ? err.message : String(err) };
              }
              client({ type: "tool", callId, name, status: "done" });
              responses.push({ id: callId, name, response: { result } });
            }
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
            }
          })();
          return;
        }
        const content = msg.serverContent;
        if (!content) return;
        if (content.interrupted) {
          client({ type: "interrupted" });
          finalizeAgent();
          return;
        }
        if (content.inputTranscription?.text) {
          userText += content.inputTranscription.text;
          client({ type: "transcript", role: "user", text: userText, final: false });
        }
        if (content.outputTranscription?.text) {
          finalizeUser(); // agent replying means the user turn ended
          agentText += content.outputTranscription.text;
          client({ type: "transcript", role: "agent", text: agentText, final: false });
        }
        const parts = content.modelTurn?.parts ?? [];
        for (const part of parts) {
          if (part.inlineData?.data) {
            finalizeUser();
            client({ type: "audio", data: part.inlineData.data });
          }
        }
        if (content.turnComplete) {
          finalizeAgent();
        }
      };

      ws.addEventListener("open", () => {
        opened = true;
        ws.send(
          JSON.stringify({
            setup: {
              model: `models/${model}`,
              generationConfig: { responseModalities: ["AUDIO"] },
              systemInstruction: { parts: [{ text: instructions }] },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              ...(tools.length > 0
                ? {
                    tools: [
                      {
                        functionDeclarations: tools.map(({ name, description, parameters }) => ({
                          name,
                          description,
                          parameters: toGeminiSchema(parameters),
                        })),
                      },
                    ],
                  }
                : {}),
            },
          }),
        );
      });
      ws.addEventListener("message", (evt) => handle(evt.data));
      ws.addEventListener("close", (evt) => {
        if (!ready) {
          reject(new Error(`Gemini Live connection failed (${evt.code}) ${evt.reason ?? ""}`));
        } else {
          client({ type: "closed" });
        }
      });
      ws.addEventListener("error", () => {
        if (!opened) reject(new Error("Gemini Live connection error (check API key)"));
      });
    });
  },
};
