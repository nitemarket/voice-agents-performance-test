import type { Timing } from "../lib/api";
import type { StageId } from "./ProviderPicker";

export type PipelineStage = "idle" | "recording" | "stt" | "llm" | "tts" | "playing";

const STAGES: { id: StageId; label: string }[] = [
  { id: "stt", label: "STT" },
  { id: "llm", label: "LLM" },
  { id: "tts", label: "TTS" },
];

interface Props {
  stage: PipelineStage;
  timings: Partial<Record<StageId, Timing>>;
  error: { stage: string; message: string } | null;
  onToggleRecord: () => void;
}

export function VoiceWidget({ stage, timings, error, onToggleRecord }: Props) {
  const busy = stage !== "idle" && stage !== "recording";
  const buttonLabel =
    stage === "recording" ? "Stop & send" : busy ? "Working…" : "Start talking";

  return (
    <div className="widget">
      <button
        className={`mic-button ${stage === "recording" ? "recording" : ""}`}
        onClick={onToggleRecord}
        disabled={busy}
      >
        {buttonLabel}
      </button>

      <div className="stages">
        {STAGES.map(({ id, label }) => {
          const timing = timings[id];
          const active = stage === id;
          return (
            <span key={id} className={`stage-badge ${active ? "active" : ""}`}>
              {label}
              {active && " …"}
              {timing && (
                <span className="timing">
                  {" "}
                  {Math.round(timing.totalMs)}ms
                  <span className="timing-upstream"> (api {timing.upstreamMs}ms)</span>
                </span>
              )}
            </span>
          );
        })}
        {stage === "playing" && <span className="stage-badge active">Playing 🔊</span>}
      </div>

      {error && (
        <p className="error">
          {error.stage.toUpperCase()} failed: {error.message}
        </p>
      )}
    </div>
  );
}
