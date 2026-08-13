import { Hono } from "hono";
import { resolve } from "../providers/registry";

export const ttsRoute = new Hono().post("/tts", async (c) => {
  const body = (await c.req.json()) as {
    text: string;
    provider: string;
    option: string;
  };
  const { impl, option } = resolve("tts", body.provider, body.option);
  const t0 = performance.now();
  const { audio, mime } = await impl.speak(body.text, option.model, option.voice ?? "");
  return new Response(audio, {
    headers: {
      "Content-Type": mime,
      "X-Upstream-Ms": String(Math.round(performance.now() - t0)),
    },
  });
});
