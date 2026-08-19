# Voice Agent Lab

A prototype for comparing voice-agent quality across model providers — and, centrally, for
comparing the two voice-agent architectures head-to-head: a **streamed STT → LLM → TTS
pipeline** versus **native speech-to-speech models**. Both tabs measure time-to-first-audio
so the latency gap is a number, not a feeling; the pipeline offers per-stage model choice and
inspectable text hand-offs, while native STS hears tone and responds fastest.

- **Pipeline** — **mic → speech-to-text → LLM → text-to-speech → playback**, with each stage
  independently switchable between providers to compare quality and latency per stage.
  **Streaming mode** (on by default; untick to compare against strictly-sequential
  push-to-talk) streams end-to-end as a **hands-free live conversation** — the mic stays
  open, speech transcribes as you talk, a client-side VAD detects end-of-turn, the reply
  streams through LLM → sentence-chunked TTS, and speaking over the agent **interrupts the
  pipeline mid-flight** (in-flight LLM/TTS requests are aborted and playback flushes —
  barge-in, like the STS tab). A Latency panel reports per-turn time-to-first-audio, directly
  comparable to the Speech to Speech tab's. Every STT provider supports live mode: OpenAI
  (realtime transcription API), xAI (streaming STT WebSocket), and ElevenLabs (Scribe v2
  Realtime) stream partials as you speak; Groq has no realtime API, so its live mode uses
  VAD-segmented batch — the turn's audio is buffered and transcribed in one fast batch call
  at commit (~0.5s, no partials while speaking). The pipeline agent has the **same tools**
  as the STS agent (orders lookup, knowledge base, web search) and the same support-agent
  persona — the LLM stage runs a server-side tool loop (up to 6 rounds), tool activity
  streams over SSE into the same Tool activity panel, so tool-use quality is directly
  comparable across the two architectures.
- **Speech to Speech** — hands-free realtime conversation against native speech-to-speech
  models (OpenAI Realtime, Gemini Live, Grok Voice), with live transcripts, barge-in, and
  **tool calling**: the agent plays phone support for a demo store and can call
  `get_order_status` (mock orders API), `search_knowledge_base` (RAG-lite over store
  policies), and `web_search` (Tavily; only offered when `TAVILY_API_KEY` is set). Tool
  invocations appear live in a "Tool activity" panel so you can compare how each model
  decides to use tools. Demo order numbers: 1001, 1002, 1003. A **Latency panel** reports
  per-turn time-to-first-audio (measured client-side via a lightweight energy VAD: local
  end-of-speech → first agent audio), the provider-side equivalent where the API exposes it
  (OpenAI/xAI `speech_stopped` → first audio delta), and barge-in reaction time.

## Structure

- `server/` — Bun + Hono API server. Holds all provider API keys. Organized by feature:
  - `src/pipeline/` — the STT/LLM/TTS stages behind three tiny interfaces
    (`SttProvider`, `LlmProvider`, `TtsProvider`), one file per provider in
    `pipeline/providers/`, and a registry that maps stage → provider → models.
  - `src/realtime/` — speech-to-speech adapters (`RealtimeAdapter`): one shared adapter for
    the OpenAI Realtime protocol (OpenAI + xAI), one for Gemini Live, plus their registry.
  - `src/tools/` — tools callable by the realtime agent, one file per tool, executed
    server-side.
  - `src/routes/` — the HTTP endpoints and the STS WebSocket bridge.
- `web/` — React + Vite app.
  - `src/pages/` — `PipelinePage` (push-to-talk, per-stage pickers and latency badges) and
    `StsPage` (connect/end, mute, tool activity, live transcript).
  - `src/lib/` — fetch helpers, mic recording, audio streaming (AudioWorklet capture +
    gapless PCM playback), and the STS WebSocket client.
  - `src/components/` — shared picker/widget/transcript components.

## Providers

| Provider | Pipeline stages | Speech to Speech | Env key | Free quota |
| --- | --- | --- | --- | --- |
| OpenAI | STT, LLM, TTS | `gpt-realtime`, `gpt-realtime-mini` | `OPENAI_API_KEY` | no (paid) |
| xAI Grok | STT, LLM, TTS | `grok-voice-latest`, `grok-voice-think-fast-2.0` | `XAI_API_KEY` | no (paid) |
| [Groq](https://console.groq.com) | STT, LLM, TTS | — | `GROQ_API_KEY` | yes — free tier, no credit card (rate-limited) |
| [Google Gemini](https://aistudio.google.com) | LLM, TTS | `gemini-3.1-flash-live-preview` | `GEMINI_API_KEY` | yes — AI Studio free tier (rate-limited) |
| [ElevenLabs](https://elevenlabs.io) | STT, TTS | — | `ELEVENLABS_API_KEY` | yes — free monthly credits (~10 min TTS) |
| [Tavily](https://tavily.com) | — | enables the `web_search` tool | `TAVILY_API_KEY` | yes — free tier |

Groq alone covers all three pipeline stages for free, so a single Groq key is enough to try
the whole pipeline end-to-end.

## Setup

Requires [Bun](https://bun.sh).

```bash
cp server/.env.example server/.env   # then fill in the keys
bun install
bun run dev
```

`bun run dev` starts the API server on http://localhost:8787 and the web app on
http://localhost:5173 (Vite proxies `/api`, including the WebSocket, to the server).

- **Pipeline tab**: allow microphone access, press **Start talking**, speak, press
  **Stop & send**, and hear the reply. Switch any stage's provider between turns.
- **Speech to Speech tab**: pick a realtime model, press **Connect**, and just talk —
  provider-side voice activity detection handles turn-taking, and interrupting the agent
  mid-reply cuts it off (barge-in). Try "Where's my order one thousand one?" or "Can I still
  return order 1003?" to watch tool calls happen in the Tool activity panel.

Providers whose env key is missing are hidden from the UI automatically — you can run with a
single key. Note: `.env` is only read at server start, so restart `bun run dev` after
changing keys (the file watcher does not pick it up).

## API

| Endpoint | Body | Returns |
| --- | --- | --- |
| `GET /api/providers` | — | catalog of configured pipeline providers/models per stage |
| `POST /api/stt` | multipart: `audio`, `provider`, `option` | `{ text, ms }` |
| `GET /api/stt/stream` (WebSocket) | query: `provider`; `{type:"audio", data}` + `{type:"finalize"}` up | `ready`/`partial`/`final`/`error` down; multi-turn |
| `POST /api/llm` | JSON: `{ messages, provider, option }` | `{ text, ms, tools }` (tool loop runs server-side) |
| `POST /api/llm/stream` | JSON: `{ messages, provider, option }` | SSE: `{delta}` per token, `{tool}` during tool rounds, then `{done, ms}` (or `{error}`) |
| `POST /api/tts` | JSON: `{ text, provider, option }` | audio bytes (`X-Upstream-Ms` header) |
| `GET /api/sts/providers` | — | catalog of configured realtime (speech-to-speech) providers |
| `GET /api/sts` (WebSocket) | query: `provider`, `model` | see protocol below |

`ms` / `X-Upstream-Ms` is the server-measured upstream provider latency; the UI also shows the
client-measured total per stage.

### STS WebSocket protocol

The STS WebSocket is a server-side proxy: the browser streams mic audio to our server, which
bridges to the provider's realtime API with the API key injected server-side. Tools also
execute on the server during the session. Messages are JSON:

- client → server: `{type:"audio", data:<b64 pcm16 @ inputRate>}`
- server → client:
  - `{type:"ready", inputRate, outputRate, tools}` — session live; rates in Hz
  - `{type:"audio", data}` — agent speech (b64 PCM16 @ outputRate)
  - `{type:"interrupted"}` — user barge-in; client flushes its playback queue
  - `{type:"transcript", role:"user"|"agent", text, final}`
  - `{type:"tool", callId, name, status:"running"|"done", args?}`
  - `{type:"metric", name:"provider_ttfa", ms}` — provider-side response latency (OpenAI/xAI)
  - `{type:"error", message}` · `{type:"closed"}`

Ephemeral-token/WebRTC direct connection is not implemented (out of scope for the prototype).

## Extending

- **Pipeline provider**: create (or extend) `server/src/pipeline/providers/<name>.ts`
  implementing the stage interfaces from [types.ts](server/src/pipeline/types.ts) — providers
  with OpenAI-compatible APIs are one-liners via
  [openaiCompat.ts](server/src/pipeline/openaiCompat.ts) — then add an entry to
  [registry.ts](server/src/pipeline/registry.ts). Model IDs live only in the registry, so
  bumping to newer models is a one-line change.
- **Realtime provider**: implement `RealtimeAdapter` from
  [types.ts](server/src/realtime/types.ts) in one file (OpenAI-Realtime-compatible endpoints
  can reuse [openaiCompat.ts](server/src/realtime/openaiCompat.ts)), then add an entry to
  [registry.ts](server/src/realtime/registry.ts).
- **Agent tool**: implement `ToolDef` in `server/src/tools/<name>.ts` and add it to
  [registry.ts](server/src/tools/registry.ts). Tools are offered to every realtime provider
  automatically.

The UI picks all of this up from the catalogs — no frontend changes needed.

## Not yet built (deliberately)

- Telephony ingress (e.g. Twilio Media Streams bridging G.711 into the same STS WebSocket) —
  the target end product; the server-side bridge architecture is already shaped for it.
- Ephemeral tokens / WebRTC transport for the realtime session.
- More providers: Anthropic (LLM), Deepgram (STT), Groq/ElevenLabs realtime agents.
