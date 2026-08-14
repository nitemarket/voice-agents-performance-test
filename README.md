# Voice Agent Lab

A prototype for comparing voice-agent quality across model providers. Two modes, each on its
own tab:

- **Pipeline** — **mic → speech-to-text → LLM → text-to-speech → playback**, with each stage
  independently switchable between providers to compare quality and latency.
- **Speech to Speech** — hands-free realtime conversation against native speech-to-speech
  models (OpenAI Realtime, Gemini Live, Grok Voice), with live transcripts and barge-in.

## Structure

- `server/` — Bun + Hono API server. Holds provider API keys and normalizes every provider
  behind three tiny interfaces (`SttProvider`, `LlmProvider`, `TtsProvider`).

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
Adapters live in `server/src/providers/realtime/`; add one file + a registry entry for a new
realtime provider. Ephemeral-token/WebRTC direct connection is not implemented (out of scope).

`ms` / `X-Upstream-Ms` is the server-measured upstream provider latency; the UI also shows the
client-measured total per stage.

## Adding a provider

1. Create one file in `server/src/providers/<stage>/<name>.ts` implementing the stage interface
   from [types.ts](server/src/providers/types.ts).
2. Add an entry (id, label, env key, options) to
   [registry.ts](server/src/providers/registry.ts).

The UI picks it up automatically from `GET /api/providers`. Model IDs live only in the registry,
so bumping to newer models is a one-line change.

## Not yet built (deliberately)

- Streaming (LLM tokens, chunked TTS) and realtime speech-to-speech APIs
  (OpenAI Realtime, xAI `wss://api.x.ai/v1/realtime`).
- More providers: Anthropic (LLM), Deepgram (STT), ElevenLabs (TTS) — each is one file + one
  registry entry.
