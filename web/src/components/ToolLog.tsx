export interface ToolLogEntry {
  callId: string;
  name: string;
  status: "running" | "done";
  args?: string;
}

export function ToolLog({ entries }: { entries: ToolLogEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="tool-log">
      <h2>Tool activity</h2>
      {entries.map((call) => (
        <div key={call.callId} className="tool-entry">
          <span className={`tool-status ${call.status}`}>
            {call.status === "running" ? "⏳" : "✓"}
          </span>
          <code>
            {call.name}({call.args ? call.args.slice(0, 80) : ""})
          </code>
        </div>
      ))}
    </div>
  );
}
