import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
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

// Production: serve the built web app (web/dist) from this server so a single
// container hosts everything. In dev the folder doesn't exist and Vite serves
// the frontend, so these fall through harmlessly.
app.use("*", serveStatic({ root: "../web/dist" }));
app.get("*", serveStatic({ path: "../web/dist/index.html" }));

const port = Number(process.env.PORT) || 8787;
console.log(`API server listening on http://localhost:${port}`);

export default { port, fetch: app.fetch, websocket };
