import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { resolveSts, stsCatalog } from "../providers/realtime/registry";
import type { RealtimeSession, ServerMsg } from "../providers/realtime/types";
import { availableTools } from "../tools/registry";

const SYSTEM_PROMPT = `You are the phone support agent for Acme Outfitters, a demo outdoor-gear store. A customer is calling you.

Use your tools whenever they help: get_order_status to look up orders, search_knowledge_base before answering any policy question (returns, shipping, warranty, hours), and web_search (if available) for current outside information. Briefly tell the customer you're checking before you use a tool, e.g. "one moment, let me pull that up".

Keep replies short, natural, and conversational — this is a phone call. Never read out raw JSON, URLs, or tracking numbers in full unless asked.`;

const { upgradeWebSocket, websocket } = createBunWebSocket();

export const stsWebsocket = websocket;

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
              instructions: SYSTEM_PROMPT,
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
