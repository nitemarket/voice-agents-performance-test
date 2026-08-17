import { Hono } from "hono";
import { cors } from "hono/cors";
import { providersRoute } from "./routes/providers";
import { sttRoute } from "./routes/stt";
import { llmRoute } from "./routes/llm";
import { ttsRoute } from "./routes/tts";
import { websocket } from "hono/bun";
import { stsRoute } from "./routes/sts";

const app = new Hono();

app.use("/api/*", cors());
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
