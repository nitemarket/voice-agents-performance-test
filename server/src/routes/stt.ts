import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { resolve, resolveSttStream } from "../pipeline/registry";
import type { SttStreamSession } from "../pipeline/types";

export const sttRoute = new Hono().post("/stt", async (c) => {
  const form = await c.req.formData();
  const audio = form.get("audio");
  const provider = String(form.get("provider") ?? "");
  const option = String(form.get("option") ?? "");
  if (!(audio instanceof File)) {
    return c.json({ error: "Missing audio file" }, 400);
  }
  const { impl, option: opt } = resolve("stt", provider, option);
  const t0 = performance.now();
  const text = await impl.transcribe(audio, opt.model);
  return c.json({ text, ms: Math.round(performance.now() - t0) });
});

// Live transcription bridge: the browser streams mic PCM while the user talks;
// partials stream back; {type:"finalize"} commits the turn and the session
// keeps listening. Multi-turn, used by the pipeline tab's live mode.
sttRoute.get(
  "/stt/stream",
  upgradeWebSocket((c) => {
    const providerId = c.req.query("provider") ?? "";
    let session: SttStreamSession | null = null;
    let clientClosed = false;
    let finalizeAt = 0;

    return {
      async onOpen(_evt, ws) {
        const send = (msg: unknown) => {
          if (!clientClosed) ws.send(JSON.stringify(msg));
        };
        try {
          const { adapter, model } = resolveSttStream(providerId);
          session = await adapter.stream({
            model,
            onPartial: (text) => send({ type: "partial", text }),
            onFinal: (text) =>
              send({
                type: "final",
                text,
                ms: finalizeAt ? Math.round(performance.now() - finalizeAt) : 0,
              }),
            onError: (message) => send({ type: "error", message }),
          });
          if (clientClosed) {
            session.close();
            return;
          }
          send({ type: "ready", inputRate: adapter.inputRate });
        } catch (err) {
          console.error("STT stream failed:", err);
          send({ type: "error", message: err instanceof Error ? err.message : String(err) });
          ws.close();
        }
      },
      onMessage(evt) {
        try {
          const msg = JSON.parse(String(evt.data));
          if (msg.type === "audio" && typeof msg.data === "string") {
            session?.sendAudio(msg.data);
          } else if (msg.type === "finalize") {
            finalizeAt = performance.now();
            session?.finalizeTurn();
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
