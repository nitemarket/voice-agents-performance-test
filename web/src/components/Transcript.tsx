import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "../lib/api";

interface Props {
  messages: ChatMessage[];
  onReset: () => void;
}

export function Transcript({ messages, onReset }: Props) {
  if (messages.length === 0) {
    return <p className="transcript-empty">No conversation yet — press the button and speak.</p>;
  }
  return (
    <div className="transcript">
      <div className="transcript-header">
        <h2>Transcript</h2>
        <button className="reset" onClick={onReset}>
          Reset
        </button>
      </div>
      {messages.map((m, i) => (
        <div key={i} className={`turn turn-${m.role}`}>
          <span className="turn-role">{m.role === "user" ? "You" : "Agent"}</span>
          {m.role === "assistant" ? (
            <div className="turn-md">
              <ReactMarkdown>{m.content}</ReactMarkdown>
            </div>
          ) : (
            <p>{m.content}</p>
          )}
        </div>
      ))}
    </div>
  );
}
