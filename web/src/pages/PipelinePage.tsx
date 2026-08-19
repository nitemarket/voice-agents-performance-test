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
import { eagerFirstCut, extractSentences, streamChat, toSpeakable } from "../lib/llmStream";
import { DecodedQueuePlayer } from "../lib/decodedPlayer";
import { startLiveStt, type LiveSttSession } from "../lib/sttStream";
import { play } from "../lib/player";
import { Recorder } from "../lib/recorder";
import { ProviderPicker, type StageId } from "../components/ProviderPicker";
import { VoiceWidget, type PipelineStage } from "../components/VoiceWidget";
import { Transcript } from "../components/Transcript";
import { LatencyPanel, type LatencyEntry } from "../components/LatencyPanel";
import { ToolLog, type ToolLogEntry } from "../components/ToolLog";

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
  const [toolLog, setToolLog] = useState<ToolLogEntry[]>([]);
  const toolSeq = useRef(0);

  const recorder = useRef(new Recorder());
  const liveStt = useRef<LiveSttSession | null>(null);
  const livePlayer = useRef<DecodedQueuePlayer | null>(null);
  const liveAbort = useRef<AbortController | null>(null);
  const replying = useRef(false);
  const speechEndAt = useRef<number | null>(null);
  const sttFinalizeMs = useRef(0);
  const pendingTurn = useRef<string | null>(null);
  const dispatchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userSpeaking = useRef(false);
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

  function recordTool(event: { id: string; name: string; status: "running" | "done"; args?: string }) {
    setToolLog((log) => {
      const existing = log.find((t) => t.callId === event.id);
      if (existing) {
        return log.map((t) => (t.callId === event.id ? { ...t, status: event.status } : t));
      }
      return [...log, { callId: event.id, name: event.name, status: event.status, args: event.args }];
    });
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
    // Server tool ids restart per request ("web_search-1"), so namespace them
    // per turn or later turns' calls would collapse into earlier log entries.
    const turnTag = ++toolSeq.current;
    let firstTokenMs = 0;
    let fullText = "";
    let pending = "";
    let llmDone = false;
    let streamError: string | null = null;
    let ttsError: string | null = null;

    // TTS fetches start immediately per chunk and run in parallel; the
    // playback worker awaits them in order, so audio stays sequential but the
    // network latency of chunk N+1 overlaps chunk N's playback.
    const audioQueue: Promise<Blob | null>[] = [];
    const queueTts = (sentence: string) => {
      const speakText = toSpeakable(sentence);
      if (!speakText) return;
      audioQueue.push(
        speak(speakText, sel.tts, signal)
          .then((tts) => {
            setTimings((t) => ({ ...t, tts: tts.timing }));
            return tts.audio;
          })
          .catch((err) => {
            if (!signal?.aborted) {
              ttsError = err instanceof Error ? err.message : String(err);
            }
            return null;
          }),
      );
    };

    const playbackWorker = (async () => {
      for (let i = 0; ; i++) {
        while (i >= audioQueue.length) {
          if (llmDone || signal?.aborted) return;
          await new Promise((r) => setTimeout(r, 30));
        }
        const audio = await audioQueue[i];
        if (signal?.aborted) return;
        if (audio) await player.enqueue(audio);
      }
    })();

    try {
      for await (const event of streamChat(history, sel.llm, signal)) {
        if ("error" in event) {
          streamError = event.error;
          break;
        }
        if ("tool" in event) {
          recordTool({ ...event.tool, id: `${turnTag}:${event.tool.id}` });
          // A tool call is an utterance boundary: the model's pre-tool text
          // ("one moment, let me check…") is complete — speak it now so it
          // covers the tool wait instead of sitting in the buffer.
          if (pending.trim()) {
            queueTts(pending.trim());
            pending = "";
          }
          // Post-tool text concatenates without whitespace ("Lumpur.In…");
          // add a separator so display and sentence detection work.
          if (fullText && !/\s$/.test(fullText)) {
            fullText += " ";
            updatePartialReply(fullText);
          }
          continue;
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
        sentences.forEach(queueTts);
        pending = rest;
        // Before any audio is queued, cut the first chunk at a clause
        // boundary so speech starts before the first full sentence completes.
        if (audioQueue.length === 0) {
          const cut = eagerFirstCut(pending);
          if (cut) {
            queueTts(cut.head);
            pending = cut.rest;
          }
        }
      }
    } catch (err) {
      llmDone = true;
      await playbackWorker.catch(() => {});
      if (signal?.aborted) return fullText;
      throw err;
    }
    if (pending.trim() && !signal?.aborted) queueTts(pending.trim());
    llmDone = true;
    await playbackWorker;
    if (streamError) throw new Error(streamError);
    if (ttsError && !signal?.aborted) throw new Error(ttsError);
    return fullText;
  }

  // ---- Live (hands-free) mode: streaming STT + barge-in ----

  // Turn merging: a committed transcript is held briefly before dispatch so a
  // thinking pause ("…more information about the <pause> LRT disruption")
  // merges into one turn instead of sending the fragment to the LLM.
  const COMPLETE_DISPATCH_MS = 350;
  const INCOMPLETE_DISPATCH_MS = 1200;
  const CONTINUATION_WORDS = new Set([
    "the", "a", "an", "to", "of", "in", "on", "at", "for", "about", "with",
    "and", "or", "but", "so", "then", "how", "what", "my", "your", "is", "are",
  ]);

  function looksComplete(text: string): boolean {
    if (!/[.!?…。！？]$/.test(text)) return false;
    const lastWord = text
      .replace(/[.!?…。！？]+$/, "")
      .split(/\s+/)
      .pop()
      ?.toLowerCase();
    return !lastWord || !CONTINUATION_WORDS.has(lastWord);
  }

  function queueTurnSegment(text: string, sttMs: number) {
    sttFinalizeMs.current = sttMs;
    const trimmed = text.trim();
    if (trimmed) {
      pendingTurn.current = pendingTurn.current ? `${pendingTurn.current} ${trimmed}` : trimmed;
      setPartialUser(pendingTurn.current);
    }
    if (dispatchTimer.current) clearTimeout(dispatchTimer.current);
    const pending = pendingTurn.current;
    if (!pending) return;
    const delay = looksComplete(pending) ? COMPLETE_DISPATCH_MS : INCOMPLETE_DISPATCH_MS;
    dispatchTimer.current = setTimeout(() => {
      dispatchTimer.current = null;
      if (userSpeaking.current) return; // resumed talking — wait for the next segment
      const turn = pendingTurn.current;
      pendingTurn.current = null;
      if (turn) void handleLiveTurn(turn);
    }, delay);
  }

  async function startLive() {
    if (!selections || liveStatus !== "idle") return;
    setError(null);
    setLatency([]);
    setTimings({});
    setToolLog([]);
    turnCount.current = 0;
    setLiveStatus("connecting");
    // One player for the whole session, created on the user's click so the
    // AudioContext is never gesture-blocked; turns share it and flush on barge-in.
    livePlayer.current = new DecodedQueuePlayer();
    try {
      liveStt.current = await startLiveStt(
        selections.stt.provider,
        {
          onPartial: (text) =>
            setPartialUser(
              pendingTurn.current ? `${pendingTurn.current} ${text}` : text || null,
            ),
          onFinal: (text, ms) => queueTurnSegment(text, ms),
          onError: (message) => setError({ stage: "stt", message }),
          onClosed: () => stopLive(),
        },
        {
          onSpeechStart: () => {
            userSpeaking.current = true;
            // resumed speech absorbs any turn waiting for dispatch
            if (dispatchTimer.current) {
              clearTimeout(dispatchTimer.current);
              dispatchTimer.current = null;
            }
            if (replying.current) abortReply();
          },
          onSpeechEnd: (ts) => {
            userSpeaking.current = false;
            speechEndAt.current = ts;
            // Always commit — even mid-reply — so continuation speech never
            // lingers in the provider's buffer and leaks into the next turn.
            liveStt.current?.finalizeTurn();
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
    // A new turn always kills any reply still in flight — this is what
    // guarantees at most one agent voice at a time, even in race windows
    // where barge-in didn't fire.
    abortReply();
    const player = livePlayer.current;
    if (!player) return;
    const history: ChatMessage[] = [...messagesRef.current, { role: "user", content: text }];
    setMessages(history);
    replying.current = true;
    setLiveStatus("replying");

    const abort = new AbortController();
    liveAbort.current = abort;
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
      // Only reset state if this turn is still the active one (it may have
      // been superseded by a barge-in or a newer turn).
      if (liveAbort.current === abort) {
        liveAbort.current = null;
        replying.current = false;
        if (liveStt.current) setLiveStatus("listening");
      }
    }
  }

  /** Kill the in-flight reply, if any: barge-in and new-turn takeover. */
  function abortReply() {
    liveAbort.current?.abort();
    liveAbort.current = null;
    livePlayer.current?.flush(); // stops audio instantly; player stays usable
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
    if (dispatchTimer.current) {
      clearTimeout(dispatchTimer.current);
      dispatchTimer.current = null;
    }
    pendingTurn.current = null;
    userSpeaking.current = false;
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
      for (const name of llm.tools) {
        recordTool({ id: `${name}-${++toolSeq.current}`, name, status: "done" });
      }
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
      <ToolLog entries={toolLog} />

      <Transcript
        messages={displayMessages}
        onReset={() => {
          setMessages([]);
          setToolLog([]);
        }}
      />
    </main>
  );
}
