import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../lib/api";
import { connectSts, type StsConnection, type StsServerMsg } from "../lib/stsClient";
import { MicStream, StreamPlayer } from "../lib/audioStream";
import { Transcript } from "../components/Transcript";
import { LatencyPanel } from "../components/LatencyPanel";
import { ToolLog, type ToolLogEntry } from "../components/ToolLog";

interface StsProvider {
  id: string;
  label: string;
  models: { id: string; label: string }[];
}

type Status = "idle" | "connecting" | "live";

interface TurnLatency {
  turn: number;
  ttfaMs: number; // perceived: local end-of-speech → first agent audio
  providerMs?: number; // provider-side, where the API exposes it (OpenAI/xAI)
  bargeMs?: number; // barge-in: local speech start → agent audio flushed
}

export default function StsPage() {
  const [catalog, setCatalog] = useState<StsProvider[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ provider: string; model: string } | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState<ChatMessage[]>([]);
  const [partial, setPartial] = useState<{ user?: string; agent?: string }>({});
  const [toolCalls, setToolCalls] = useState<ToolLogEntry[]>([]);
  const [toolNames, setToolNames] = useState<string[]>([]);
  const [latency, setLatency] = useState<TurnLatency[]>([]);
  const [error, setError] = useState<string | null>(null);

  const conn = useRef<StsConnection | null>(null);
  const mic = useRef<MicStream | null>(null);
  const player = useRef<StreamPlayer | null>(null);
  const speechEndAt = useRef<number | null>(null);
  const providerMs = useRef<number | null>(null);
  const bargeStartAt = useRef<number | null>(null);
  const turnCount = useRef(0);

  useEffect(() => {
    fetch("/api/sts/providers")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((cat: StsProvider[]) => {
        setCatalog(cat);
        if (cat.length > 0) {
          setSelection({ provider: cat[0].id, model: cat[0].models[0].id });
        }
      })
      .catch((err) => setCatalogError(err.message));
    return disconnect; // clean up session on unmount / tab switch
  }, []);

  function disconnect() {
    mic.current?.stop();
    mic.current = null;
    player.current?.close();
    player.current = null;
    const c = conn.current;
    conn.current = null;
    c?.close();
    setStatus("idle");
    setMuted(false);
    setPartial({});
  }

  function handleMessage(msg: StsServerMsg) {
    switch (msg.type) {
      case "ready": {
        setToolNames(msg.tools);
        player.current = new StreamPlayer(msg.outputRate);
        const m = new MicStream();
        mic.current = m;
        m.start(msg.inputRate, (b64) => conn.current?.sendAudio(b64), {
          onSpeechStart: () => {
            if (player.current?.playing) bargeStartAt.current = performance.now();
          },
          onSpeechEnd: (ts) => {
            speechEndAt.current = ts;
          },
        })
          .then(() => setStatus("live"))
          .catch(() => {
            setError("Microphone access denied or unavailable");
            disconnect();
          });
        break;
      }
      case "audio":
        if (speechEndAt.current !== null) {
          const entry: TurnLatency = {
            turn: ++turnCount.current,
            ttfaMs: Math.round(performance.now() - speechEndAt.current),
            ...(providerMs.current !== null ? { providerMs: providerMs.current } : {}),
          };
          speechEndAt.current = null;
          providerMs.current = null;
          setLatency((l) => [...l, entry]);
        }
        player.current?.push(msg.data);
        break;
      case "metric":
        providerMs.current = msg.ms;
        break;
      case "interrupted":
        if (bargeStartAt.current !== null) {
          const bargeMs = Math.round(performance.now() - bargeStartAt.current);
          bargeStartAt.current = null;
          setLatency((l) =>
            l.length > 0 ? [...l.slice(0, -1), { ...l[l.length - 1], bargeMs }] : l,
          );
        }
        player.current?.flush();
        break;
      case "transcript":
        if (msg.final) {
          const turn: ChatMessage = {
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.text,
          };
          setTurns((t) => [...t, turn]);
          setPartial((p) => ({ ...p, [msg.role]: undefined }));
        } else {
          setPartial((p) => ({ ...p, [msg.role]: msg.text }));
        }
        break;
      case "tool":
        setToolCalls((calls) => {
          const existing = calls.find((c) => c.callId === msg.callId);
          if (existing) {
            return calls.map((c) =>
              c.callId === msg.callId ? { ...c, status: msg.status } : c,
            );
          }
          return [...calls, { callId: msg.callId, name: msg.name, status: msg.status, args: msg.args }];
        });
        break;
      case "error":
        setError(msg.message);
        disconnect();
        break;
      case "closed":
        disconnect();
        break;
    }
  }

  function connect() {
    if (!selection) return;
    setError(null);
    setToolCalls([]);
    setLatency([]);
    speechEndAt.current = null;
    providerMs.current = null;
    bargeStartAt.current = null;
    turnCount.current = 0;
    setStatus("connecting");
    conn.current = connectSts(selection.provider, selection.model, handleMessage, () => {
      if (conn.current) disconnect();
    });
  }

  function toggleMute() {
    if (mic.current) {
      mic.current.muted = !mic.current.muted;
      setMuted(mic.current.muted);
    }
  }

  const displayTurns: ChatMessage[] = [
    ...turns,
    ...(partial.user ? [{ role: "user" as const, content: `${partial.user} …` }] : []),
    ...(partial.agent ? [{ role: "assistant" as const, content: `${partial.agent} …` }] : []),
  ];

  if (catalogError) {
    return (
      <main className="app">
        <h1>Speech to Speech</h1>
        <p className="error">Could not reach the API server: {catalogError}</p>
      </main>
    );
  }

  if (!catalog || !selection) {
    return (
      <main className="app">
        <h1>Speech to Speech</h1>
        {catalog ? (
          <p className="error">
            No realtime providers configured — add OPENAI_API_KEY, GEMINI_API_KEY and/or
            XAI_API_KEY to server/.env and restart.
          </p>
        ) : (
          <p>Loading providers…</p>
        )}
      </main>
    );
  }

  const provider = catalog.find((p) => p.id === selection.provider);

  return (
    <main className="app">
      <h1>Speech to Speech</h1>
      <div className="pickers">
        <div className="picker">
          <span className="picker-label">Realtime model</span>
          <select
            value={selection.provider}
            disabled={status !== "idle"}
            onChange={(e) => {
              const next = catalog.find((p) => p.id === e.target.value)!;
              setSelection({ provider: next.id, model: next.models[0].id });
            }}
          >
            {catalog.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={selection.model}
            disabled={status !== "idle" || !provider || provider.models.length < 2}
            onChange={(e) => setSelection({ ...selection, model: e.target.value })}
          >
            {provider?.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="widget">
        {status === "idle" ? (
          <button className="mic-button" onClick={connect}>
            Connect
          </button>
        ) : (
          <button className="mic-button recording" onClick={disconnect}>
            {status === "connecting" ? "Connecting…" : "End conversation"}
          </button>
        )}
        <div className="stages">
          <span className={`stage-badge ${status === "live" ? "active" : ""}`}>
            {status === "idle" && "Disconnected"}
            {status === "connecting" && "Connecting…"}
            {status === "live" && (muted ? "Muted" : "Live — just talk")}
          </span>
          {status === "live" && (
            <button className="stage-badge mute-toggle" onClick={toggleMute}>
              {muted ? "Unmute mic" : "Mute mic"}
            </button>
          )}
        </div>
        {status === "live" && toolNames.length > 0 && (
          <p className="tool-names">Tools available: {toolNames.join(", ")}</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      <LatencyPanel
        entries={latency.map((l) => ({
          turn: l.turn,
          ttfaMs: l.ttfaMs,
          detail:
            [
              l.providerMs !== undefined ? `provider ${l.providerMs}ms` : null,
              l.bargeMs !== undefined ? `barge-in stop ${l.bargeMs}ms` : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
        }))}
      />

      <ToolLog entries={toolCalls} />

      <Transcript
        messages={displayTurns}
        onReset={() => {
          setTurns([]);
          setToolCalls([]);
        }}
      />
    </main>
  );
}
