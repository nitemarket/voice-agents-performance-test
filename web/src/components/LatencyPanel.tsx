export interface LatencyEntry {
  turn: number;
  ttfaMs: number;
  detail?: string; // e.g. "provider 510ms · barge-in stop 180ms"
}

export function LatencyPanel({ entries }: { entries: LatencyEntry[] }) {
  if (entries.length === 0) return null;
  const avg = Math.round(entries.reduce((s, e) => s + e.ttfaMs, 0) / entries.length);
  return (
    <div className="tool-log">
      <h2>Latency</h2>
      <p className="latency-summary">
        First audio after you stop speaking — avg {avg}ms over {entries.length} turn
        {entries.length > 1 ? "s" : ""}
      </p>
      {entries.slice(-5).map((e) => (
        <div key={e.turn} className="tool-entry">
          <span className="tool-status done">⏱</span>
          <span>
            Turn {e.turn}: first audio <strong>{e.ttfaMs}ms</strong>
            {e.detail ? ` · ${e.detail}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
