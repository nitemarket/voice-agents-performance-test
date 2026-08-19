import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { resolveSts, stsCatalog } from "../realtime/registry";
import type { RealtimeSession, ServerMsg } from "../realtime/types";
import { availableTools } from "../tools/registry";
import { SUPPORT_AGENT_PROMPT } from "../prompt";

export const stsRoute = new Hono()
  .get("/sts/providers", (c) => c.json(stsCatalog()))
  .get(
    "/sts",
    upgradeWebSocket((c) => {
      const providerId = c.req.query("provider") ?? "";
      const model = c.req.query("model") ?? "";
      let session: RealtimeSession | null = null;
      let clientClosed = false;

      return {
        async onOpen(_evt, ws) {
          const send = (msg: ServerMsg) => {
            if (!clientClosed) ws.send(JSON.stringify(msg));
          };
          try {
            const entry = resolveSts(providerId);
            const tools = availableTools();
            session = await entry.adapter.createSession({
              model,
              instructions: SUPPORT_AGENT_PROMPT,
              tools,
              client: send,
            });
            if (clientClosed) {
              session.close();
              return;
            }
            send({
              type: "ready",
              inputRate: entry.adapter.inputRate,
              outputRate: entry.adapter.outputRate,
              tools: tools.map((t) => t.name),
            });
          } catch (err) {
            console.error("STS session failed:", err);
            send({ type: "error", message: err instanceof Error ? err.message : String(err) });
            ws.close();
          }
        },
        onMessage(evt) {
          try {
            const msg = JSON.parse(String(evt.data));
            if (msg.type === "audio" && typeof msg.data === "string") {
              session?.sendAudio(msg.data);
            }
          } catch {
            // ignore malformed client messages
          }
        },
        onClose() {
          clientClosed = true;
          session?.close();
          session = null;
        },
      };
    }),
  );
