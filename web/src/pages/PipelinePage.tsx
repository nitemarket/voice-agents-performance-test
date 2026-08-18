import { useEffect, useRef, useState } from "react";
import {
  chat,
  fetchCatalog,
  speak,
  transcribe,
  type Catalog,
  type ChatMessage,
  type Selection,
  type Timing,
} from "../lib/api";
import { extractSentences, streamChat } from "../lib/llmStream";
import { DecodedQueuePlayer } from "../lib/decodedPlayer";
import { startLiveStt, type LiveSttSession } from "../lib/sttStream";
import { play } from "../lib/player";
import { Recorder } from "../lib/recorder";
import { ProviderPicker, type StageId } from "../components/ProviderPicker";
import { VoiceWidget, type PipelineStage } from "../components/VoiceWidget";
import { Transcript } from "../components/Transcript";
import { LatencyPanel, type LatencyEntry } from "../components/LatencyPanel";

type Selections = Record<StageId, Selection>;
type LiveStatus = "idle" | "connecting" | "listening" | "replying";

function defaultSelections(catalog: Catalog): Selections | null {
  const pick = (stage: StageId): Selection | null => {
    const first = catalog[stage][0];
    return first ? { provider: first.id, option: first.options[0].id } : null;
  };
  const stt = pick("stt");
  const llm = pick("llm");
  const tts = pick("tts");
  return stt && llm && tts ? { stt, llm, tts } : null;
}

export default function PipelinePage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selections, setSelections] = useState<Selections | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [timings, setTimings] = useState<Partial<Record<StageId, Timing>>>({});
  const [error, setError] = useState<{ stage: string; message: string } | null>(null);
  const [streaming, setStreaming] = useState(true);
  const [firstAudioMs, setFirstAudioMs] = useState<number | null>(null);
  const [partialUser, setPartialUser] = useState<string | null>(null);
  const [partialReply, setPartialReply] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("idle");
  const [latency, setLatency] = useState<LatencyEntry[]>([]);

  const recorder = useRef(new Recorder());
  const liveStt = useRef<LiveSttSession | null>(null);
  const livePlayer = useRef<DecodedQueuePlayer | null>(null);
  const liveAbort = useRef<AbortController | null>(null);
  const replying = useRef(false);
  const speechEndAt = useRef<number | null>(null);
  const sttFinalizeMs = useRef(0);
  const turnCount = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const partialReplyRef = useRef<string | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    fetchCatalog()
      .then((cat) => {
        setCatalog(cat);
        setSelections(defaultSelections(cat));
      })
      .catch((err) => setCatalogError(err.message));
    return stopLive; // clean up a live session on unmount / tab switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updatePartialReply(text: string | null) {
    partialReplyRef.current = text;
    setPartialReply(text);
  }

  /**
   * Shared streamed-reply path: LLM tokens stream in, complete sentences are
   * synthesized and queued on the player while generation continues.
   * Abortable for barge-in. Returns the full reply text.
   */
  async function streamReplyToPlayer(
    history: ChatMessage[],
    sel: Selections,
    player: DecodedQueuePlayer,
    signal?: AbortSignal,
  ): Promise<string> {
    const tLlm = performance.now();
    let firstTokenMs = 0;
    let fullText = "";
    let pending = "";
    const sentenceQueue: string[] = [];
    let llmDone = false;
    let streamError: string | null = null;

    const ttsWorker = (async () => {
      for (;;) {
        if (signal?.aborted) return;
        const sentence = sentenceQueue.shift();
        if (sentence === undefined) {
          if (llmDone) return;
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        try {
          const tts = await speak(sentence, sel.tts, signal);
          setTimings((t) => ({ ...t, tts: tts.timing }));
          if (!signal?.aborted) await player.enqueue(tts.audio);
        } catch (err) {
          if (signal?.aborted) return;
          throw err;
        }
      }
    })();

    try {
      for await (const event of streamChat(history, sel.llm, signal)) {
        if ("error" in event) {
          streamError = event.error;
          break;
        }
        if ("done" in event) {
          setTimings((t) => ({
            ...t,
            llm: { totalMs: performance.now() - tLlm, upstreamMs: firstTokenMs },
          }));
          break;
        }
        if (!firstTokenMs) firstTokenMs = Math.round(performance.now() - tLlm);
        fullText += event.delta;
        pending += event.delta;
        updatePartialReply(fullText);
        const { sentences, rest } = extractSentences(pending);
        sentenceQueue.push(...sentences);
        pending = rest;
      }
    } catch (err) {
      if (signal?.aborted) {
        llmDone = true;
        await ttsWorker.catch(() => {});
        return fullText;
      }
      throw err;
    }
    if (pending.trim() && !signal?.aborted) sentenceQueue.push(pending.trim());
    llmDone = true;
    await ttsWorker;
    if (streamError) throw new Error(streamError);
    return fullText;
  }

  // ---- Live (hands-free) mode: streaming STT + barge-in ----

  async function startLive() {
    if (!selections) return;
    setError(null);
    setLatency([]);
    setTimings({});
    turnCount.current = 0;
    setLiveStatus("connecting");
    try {
      liveStt.current = await startLiveStt(
        selections.stt.provider,
        {
          onPartial: (text) => setPartialUser(text || null),
          onFinal: (text, ms) => {
            sttFinalizeMs.current = ms;
            void handleLiveTurn(text);
          },
          onError: (message) => setError({ stage: "stt", message }),
          onClosed: () => stopLive(),
        },
        {
          onSpeechStart: () => {
            if (replying.current) abortReply();
          },
          onSpeechEnd: (ts) => {
            if (!replying.current) {
              speechEndAt.current = ts;
              liveStt.current?.finalizeTurn();
            }
          },
        },
      );
      setLiveStatus("listening");
    } catch (err) {
      setError({ stage: "stt", message: err instanceof Error ? err.message : String(err) });
      setLiveStatus("idle");
    }
  }

  async function handleLiveTurn(text: string) {
    if (!selections) return;
    setPartialUser(null);
    if (!text.trim()) return; // noise-only turn
    const history: ChatMessage[] = [...messagesRef.current, { role: "user", content: text }];
    setMessages(history);
    replying.current = true;
    setLiveStatus("replying");

    const abort = new AbortController();
    liveAbort.current = abort;
    const player = new DecodedQueuePlayer();
    livePlayer.current = player;
    const t0 = speechEndAt.current;
    player.onFirstAudio = () => {
      if (t0 !== null) {
        setLatency((l) => [
          ...l,
          {
            turn: ++turnCount.current,
            ttfaMs: Math.round(performance.now() - t0),
            detail: `stt finalize ${sttFinalizeMs.current}ms`,
          },
        ]);
      }
    };

    try {
      const fullText = await streamReplyToPlayer(history, selections, player, abort.signal);
      if (!abort.signal.aborted) {
        setMessages([...history, { role: "assistant", content: fullText }]);
        updatePartialReply(null);
        await player.drain();
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        setError({ stage: "llm", message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      if (livePlayer.current === player) {
        player.close();
        livePlayer.current = null;
      }
      if (!abort.signal.aborted) {
        replying.current = false;
        if (liveStt.current) setLiveStatus("listening");
      }
    }
  }

  /** Barge-in: user spoke while the agent was replying. Local, so instant. */
  function abortReply() {
    liveAbort.current?.abort();
    liveAbort.current = null;
    livePlayer.current?.close();
    livePlayer.current = null;
    replying.current = false;
    if (partialReplyRef.current) {
      const interrupted = partialReplyRef.current;
      setMessages((m) => [...m, { role: "assistant", content: `${interrupted} …(interrupted)` }]);
    }
    updatePartialReply(null);
    if (liveStt.current) setLiveStatus("listening");
  }

  function stopLive() {
    liveAbort.current?.abort();
    liveAbort.current = null;
    livePlayer.current?.close();
    livePlayer.current = null;
    liveStt.current?.close();
    liveStt.current = null;
    replying.current = false;
    setPartialUser(null);
    updatePartialReply(null);
    setLiveStatus("idle");
  }

  // ---- Push-to-talk modes ----

  // Streaming mode fallback for STT providers without realtime transcription:
  // batch STT upload, then streamed LLM + chunked TTS.
  async function runPipelineStreaming(audio: Blob, sel: Selections) {
    setTimings({});
    setFirstAudioMs(null);
    setError(null);
    const t0 = performance.now();
    let current: StageId = "stt";
    const player = new DecodedQueuePlayer();
    player.onFirstAudio = () => setFirstAudioMs(Math.round(performance.now() - t0));
    try {
      const stt = await transcribe(audio, sel.stt);
      setTimings((t) => ({ ...t, stt: stt.timing }));
      if (!stt.text.trim()) throw new Error("No speech detected");
      const history: ChatMessage[] = [...messages, { role: "user", content: stt.text }];
      setMessages(history);

      current = "llm";
      setStage("llm");
      const fullText = await streamReplyToPlayer(history, sel, player);
      setMessages([...history, { role: "assistant", content: fullText }]);
      updatePartialReply(null);

      current = "tts";
      setStage("playing");
      await player.drain();
    } catch (err) {
      setError({ stage: current, message: err instanceof Error ? err.message : String(err) });
    } finally {
      updatePartialReply(null);
      player.close();
      setStage("idle");
    }
  }

  async function runPipeline(audio: Blob, sel: Selections) {
    setTimings({});
    setFirstAudioMs(null);
    setError(null);
    let current: StageId = "stt";
    try {
      const stt = await transcribe(audio, sel.stt);
      setTimings((t) => ({ ...t, stt: stt.timing }));
      if (!stt.text.trim()) throw new Error("No speech detected");
      const history: ChatMessage[] = [...messages, { role: "user", content: stt.text }];
      setMessages(history);

      current = "llm";
      setStage("llm");
      const llm = await chat(history, sel.llm);
      setTimings((t) => ({ ...t, llm: llm.timing }));
      setMessages([...history, { role: "assistant", content: llm.text }]);

      current = "tts";
      setStage("tts");
      const tts = await speak(llm.text, sel.tts);
      setTimings((t) => ({ ...t, tts: tts.timing }));

      setStage("playing");
      await play(tts.audio);
    } catch (err) {
      setError({ stage: current, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setStage("idle");
    }
  }

  async function toggleRecord() {
    if (!selections) return;
    if (recorder.current.isRecording) {
      setStage("stt");
      try {
        const audio = await recorder.current.stop();
        await (streaming ? runPipelineStreaming(audio, selections) : runPipeline(audio, selections));
      } catch (err) {
        setError({ stage: "mic", message: err instanceof Error ? err.message : String(err) });
        setStage("idle");
      }
    } else {
      setError(null);
      try {
        await recorder.current.start();
        setStage("recording");
      } catch (err) {
        setError({ stage: "mic", message: "Microphone access denied or unavailable" });
      }
    }
  }

  if (catalogError) {
    return (
      <main className="app">
        <h1>Voice Agent Lab</h1>
        <p className="error">
          Could not reach the API server: {catalogError}. Is `bun run dev` running?
        </p>
      </main>
    );
  }

  if (!catalog || !selections) {
    return (
      <main className="app">
        <h1>Voice Agent Lab</h1>
        {catalog ? (
          <p className="error">
            No providers configured — add OPENAI_API_KEY and/or XAI_API_KEY to server/.env and
            restart.
          </p>
        ) : (
          <p>Loading providers…</p>
        )}
      </main>
    );
  }

  const sttStreams = Boolean(
    catalog.stt.find((p) => p.id === selections.stt.provider)?.streaming,
  );
  const liveMode = streaming && sttStreams;
  const busy = stage !== "idle" || liveStatus !== "idle";

  const displayMessages: ChatMessage[] = [
    ...messages,
    ...(partialUser ? [{ role: "user" as const, content: `${partialUser} …` }] : []),
    ...(partialReply ? [{ role: "assistant" as const, content: `${partialReply} …` }] : []),
  ];

  return (
    <main className="app">
      <h1>Voice Agent Lab</h1>
      <ProviderPicker
        catalog={catalog}
        selections={selections}
        onChange={(stageId, sel) => setSelections({ ...selections, [stageId]: sel })}
        disabled={busy}
      />
      <label className="streaming-toggle">
        <input
          type="checkbox"
          checked={streaming}
          disabled={busy}
          onChange={(e) => setStreaming(e.target.checked)}
        />
        Streaming mode —{" "}
        {sttStreams
          ? "hands-free conversation with live transcription and barge-in"
          : "stream LLM tokens and speak sentence-by-sentence (this STT provider has no realtime mode; push-to-talk)"}
      </label>

      {liveMode ? (
        <div className="widget">
          {liveStatus === "idle" ? (
            <button className="mic-button" onClick={startLive}>
              Start conversation
            </button>
          ) : (
            <button className="mic-button recording" onClick={stopLive}>
              {liveStatus === "connecting" ? "Connecting…" : "End conversation"}
            </button>
          )}
          <div className="stages">
            <span className={`stage-badge ${liveStatus !== "idle" ? "active" : ""}`}>
              {liveStatus === "idle" && "Disconnected"}
              {liveStatus === "connecting" && "Connecting…"}
              {liveStatus === "listening" && "Live — just talk"}
              {liveStatus === "replying" && "Speaking — interrupt any time"}
            </span>
          </div>
          {error && (
            <p className="error">
              {error.stage.toUpperCase()}: {error.message}
            </p>
          )}
        </div>
      ) : (
        <VoiceWidget
          stage={stage}
          timings={timings}
          error={error}
          onToggleRecord={toggleRecord}
          mode={streaming ? "streaming" : "sequential"}
          firstAudioMs={firstAudioMs}
        />
      )}

      {liveMode && <LatencyPanel entries={latency} />}

      <Transcript messages={displayMessages} onReset={() => setMessages([])} />
    </main>
  );
}
