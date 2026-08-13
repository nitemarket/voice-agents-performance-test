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
} from "./lib/api";
import { play } from "./lib/player";
import { Recorder } from "./lib/recorder";
import { ProviderPicker, type StageId } from "./components/ProviderPicker";
import { VoiceWidget, type PipelineStage } from "./components/VoiceWidget";
import { Transcript } from "./components/Transcript";

type Selections = Record<StageId, Selection>;

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

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selections, setSelections] = useState<Selections | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [timings, setTimings] = useState<Partial<Record<StageId, Timing>>>({});
  const [error, setError] = useState<{ stage: string; message: string } | null>(null);
  const recorder = useRef(new Recorder());

  useEffect(() => {
    fetchCatalog()
      .then((cat) => {
        setCatalog(cat);
        setSelections(defaultSelections(cat));
      })
      .catch((err) => setCatalogError(err.message));
  }, []);

  async function runPipeline(audio: Blob, sel: Selections) {
    setTimings({});
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
        await runPipeline(audio, selections);
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

  return (
    <main className="app">
      <h1>Voice Agent Lab</h1>
      <ProviderPicker
        catalog={catalog}
        selections={selections}
        onChange={(stageId, sel) => setSelections({ ...selections, [stageId]: sel })}
        disabled={stage !== "idle"}
      />
      <VoiceWidget stage={stage} timings={timings} error={error} onToggleRecord={toggleRecord} />
      <Transcript messages={messages} onReset={() => setMessages([])} />
    </main>
  );
}
