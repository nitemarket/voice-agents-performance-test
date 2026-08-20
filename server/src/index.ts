import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config";
import { providersRoute } from "./routes/providers";
import { sttRoute } from "./routes/stt";
import { llmRoute } from "./routes/llm";
import { ttsRoute } from "./routes/tts";
import { websocket } from "hono/bun";
import { stsRoute } from "./routes/sts";

const app = new Hono();

app.use("/api/*", cors());

// Shared-secret gate: when ACCESS_PASSWORD is set, every /api request —
// including WebSocket upgrades, which pass through this middleware as GETs —
// must present it via the x-access-key header or the ?key= query param
// (browsers cannot set headers on WebSocket connections).
app.use("/api/*", async (c, next) => {
  if (config.accessPassword) {
    const provided = c.req.header("x-access-key") ?? c.req.query("key") ?? "";
    if (provided !== config.accessPassword) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }
  await next();
});

app.route("/api", providersRoute);
app.route("/api", sttRoute);
app.route("/api", llmRoute);
app.route("/api", ttsRoute);
app.route("/api", stsRoute);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 502);
});

console.log("API server listening on http://localhost:8787");

export default { port: 8787, fetch: app.fetch, websocket };
