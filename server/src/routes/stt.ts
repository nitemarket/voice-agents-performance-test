import { Hono } from "hono";
import { resolve } from "../providers/registry";

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
