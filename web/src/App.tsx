import { useEffect, useState } from "react";
import PipelinePage from "./pages/PipelinePage";
import StsPage from "./pages/StsPage";
import { authHeaders, setAccessKey } from "./lib/auth";

const TABS = [
  { id: "pipeline", label: "Pipeline (STT → LLM → TTS)" },
  { id: "sts", label: "Speech to Speech" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// Probes the API on load; a 401 means the server has ACCESS_PASSWORD set and
// this browser hasn't unlocked yet. Network errors fall through to the app,
// which shows its own server-unreachable message.
function AccessGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "locked" | "open">("checking");
  const [input, setInput] = useState("");
  const [failed, setFailed] = useState(false);

  async function probe() {
    try {
      const res = await fetch("/api/providers", { headers: authHeaders() });
      setState(res.status === 401 ? "locked" : "open");
      return res.status !== 401;
    } catch {
      setState("open");
      return true;
    }
  }

  useEffect(() => {
    void probe();
  }, []);

  if (state === "checking") return null;
  if (state === "open") return <>{children}</>;

  return (
    <main className="app access-gate">
      <h1>Voice Agent Lab</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setAccessKey(input.trim());
          const ok = await probe();
          setFailed(!ok);
        }}
      >
        <p>This deployment is password-protected.</p>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Access password"
          autoFocus
        />
        <button type="submit" className="mic-button">
          Unlock
        </button>
        {failed && <p className="error">Wrong password</p>}
      </form>
    </main>
  );
}

export default function App() {
  const [tab, setTab] = useState<TabId>("pipeline");
  return (
    <AccessGate>{renderTabs(tab, setTab)}</AccessGate>
  );
}

function renderTabs(tab: TabId, setTab: (t: TabId) => void) {
  return (
    <>
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === "pipeline" ? <PipelinePage /> : <StsPage />}
    </>
  );
}
