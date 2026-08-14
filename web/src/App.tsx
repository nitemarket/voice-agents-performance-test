import { useState } from "react";
import PipelinePage from "./pages/PipelinePage";
import StsPage from "./pages/StsPage";

const TABS = [
  { id: "pipeline", label: "Pipeline (STT → LLM → TTS)" },
  { id: "sts", label: "Speech to Speech" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function App() {
  const [tab, setTab] = useState<TabId>("pipeline");
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
