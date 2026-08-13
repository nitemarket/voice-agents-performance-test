import type { Catalog, Selection } from "../lib/api";

export type StageId = "stt" | "llm" | "tts";

const STAGE_LABELS: Record<StageId, string> = {
  stt: "Speech to text",
  llm: "LLM",
  tts: "Text to speech",
};

interface Props {
  catalog: Catalog;
  selections: Record<StageId, Selection>;
  onChange: (stage: StageId, selection: Selection) => void;
  disabled: boolean;
}

export function ProviderPicker({ catalog, selections, onChange, disabled }: Props) {
  return (
    <div className="pickers">
      {(Object.keys(STAGE_LABELS) as StageId[]).map((stage) => {
        const providers = catalog[stage];
        const sel = selections[stage];
        const provider = providers.find((p) => p.id === sel.provider);
        return (
          <div className="picker" key={stage}>
            <span className="picker-label">{STAGE_LABELS[stage]}</span>
            <select
              value={sel.provider}
              disabled={disabled}
              onChange={(e) => {
                const next = providers.find((p) => p.id === e.target.value)!;
                onChange(stage, { provider: next.id, option: next.options[0].id });
              }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              value={sel.option}
              disabled={disabled || !provider || provider.options.length < 2}
              onChange={(e) => onChange(stage, { ...sel, option: e.target.value })}
            >
              {provider?.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}
