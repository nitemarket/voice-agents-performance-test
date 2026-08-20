import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "../lib/api";

interface Props {
  messages: ChatMessage[];
  onReset: () => void;
}

// Collapsed by default so the user focuses on the voice conversation; the
// summary line still shows that turns are accumulating.
export function Transcript({ messages, onReset }: Props) {
  return (
    <details className="transcript">
      <summary>
        Transcript{" "}
        <span className="transcript-count">
          ({messages.length} turn{messages.length === 1 ? "" : "s"})
        </span>
      </summary>
      {messages.length === 0 ? (
        <p className="transcript-empty">No conversation yet — press the button and speak.</p>
      ) : (
        <>
          <div className="transcript-header">
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
        </>
      )}
    </details>
  );
}
