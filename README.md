# Voice Agent Lab

A prototype for comparing voice-agent quality across model providers. Two modes, each on its
own tab:

- **Pipeline** — **mic → speech-to-text → LLM → text-to-speech → playback**, with each stage
  independently switchable between providers to compare quality and latency.
- **Speech to Speech** — hands-free realtime conversation against native speech-to-speech
  models (OpenAI Realtime, Gemini Live, Grok Voice), with live transcripts, barge-in, and
  **tool calling**: the agent plays phone support for a demo store and can call
  `get_order_status` (mock orders API), `search_knowledge_base` (RAG-lite over store
  policies), and `web_search` (Tavily; only offered when `TAVILY_API_KEY` is set). Tool
  invocations appear live in a "Tool activity" panel so you can compare how each model
  decides to use tools. Demo order numbers: 1001, 1002, 1003. Tools live in
  `server/src/tools/` — one file per tool plus a registry entry, executed server-side.

## Structure

- `server/` — Bun + Hono API server. Holds all provider API keys. Organized by feature:
  - `src/pipeline/` — the STT/LLM/TTS stages behind three tiny interfaces
    (`SttProvider`, `LlmProvider`, `TtsProvider`), with one file per provider in
    `pipeline/providers/`.
  - `src/realtime/` — speech-to-speech adapters (`RealtimeAdapter`) and their registry.
  - `src/tools/` — tools callable by the realtime agent, one file per tool.

## Providers

| Provider | Stages | Env key | Free quota |
| --- | --- | --- | --- |
| OpenAI | STT, LLM, TTS | `OPENAI_API_KEY` | no (paid) |
| xAI Grok | STT, LLM, TTS | `XAI_API_KEY` | no (paid) |
| [Groq](https://console.groq.com) | STT, LLM, TTS | `GROQ_API_KEY` | yes — free tier, no credit card (rate-limited) |
| [Google Gemini](https://aistudio.google.com) | LLM, TTS | `GEMINI_API_KEY` | yes — AI Studio free tier (rate-limited) |
| [ElevenLabs](https://elevenlabs.io) | STT, TTS | `ELEVENLABS_API_KEY` | yes — free monthly credits (~10 min TTS) |

Groq alone covers all three stages for free, so a single Groq key is enough to try the whole
pipeline end-to-end.
- `web/` — React + Vite widget: push-to-talk button, per-stage provider pickers, per-stage
  latency badges, and a conversation transcript.

## Setup

Requires [Bun](https://bun.sh).

```bash
cp server/.env.example server/.env   # then fill in the keys
bun install
bun run dev
```

`bun run dev` starts the API server on http://localhost:8787 and the web app on
http://localhost:5173 (Vite proxies `/api` to the server). Open the web app, allow microphone
access, press **Start talking**, speak, then press **Stop & send**.

Providers whose env key is missing are hidden from the UI automatically — you can run with just
one of `OPENAI_API_KEY` / `XAI_API_KEY`. Note: `.env` is only read at server start, so restart
`bun run dev` after changing keys (the file watcher does not pick it up).

## API

| Endpoint | Body | Returns |
| --- | --- | --- |
| `GET /api/providers` | — | catalog of configured providers/models per stage |
| `POST /api/stt` | multipart: `audio`, `provider`, `option` | `{ text, ms }` |
| `POST /api/llm` | JSON: `{ messages, provider, option }` | `{ text, ms }` |
| `POST /api/tts` | JSON: `{ text, provider, option }` | audio bytes (`X-Upstream-Ms` header) |
| `GET /api/sts/providers` | — | catalog of configured realtime (speech-to-speech) providers |
| `GET /api/sts` (WebSocket) | query: `provider`, `model` | bidirectional JSON: `{type:"audio", data:<b64 pcm16>}` up; `ready`/`audio`/`interrupted`/`transcript`/`error`/`closed` down |

The STS WebSocket is a server-side proxy: the browser streams mic PCM to our server, which
bridges to the provider's realtime API (OpenAI Realtime protocol for OpenAI and xAI via one
shared adapter, Gemini Live protocol for Gemini) with the API key injected server-side.
Adapters live in `server/src/realtime/`; add one file + a registry entry for a new
realtime provider. Ephemeral-token/WebRTC direct connection is not implemented (out of scope).

`ms` / `X-Upstream-Ms` is the server-measured upstream provider latency; the UI also shows the
client-measured total per stage.

## Adding a provider

1. Create (or extend) the provider's file in `server/src/pipeline/providers/<name>.ts`,
   implementing the stage interfaces from [types.ts](server/src/pipeline/types.ts). Providers
   with OpenAI-compatible APIs are one-liners via
   [openaiCompat.ts](server/src/pipeline/openaiCompat.ts).
2. Add an entry (id, label, env key, options) to
   [registry.ts](server/src/pipeline/registry.ts).

The UI picks it up automatically from `GET /api/providers`. Model IDs live only in the registry,
so bumping to newer models is a one-line change.

## Not yet built (deliberately)

- Streaming (LLM tokens, chunked TTS) and realtime speech-to-speech APIs
  (OpenAI Realtime, xAI `wss://api.x.ai/v1/realtime`).
- More providers: Anthropic (LLM), Deepgram (STT), ElevenLabs (TTS) — each is one file + one
  registry entry.
