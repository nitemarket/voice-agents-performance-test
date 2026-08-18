export interface StageOption {
  id: string;
  label: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  options: StageOption[];
  /** STT only: provider supports realtime transcription (live mode). */
  streaming?: boolean;
}

export interface Catalog {
  stt: ProviderInfo[];
  llm: ProviderInfo[];
  tts: ProviderInfo[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Selection {
  provider: string;
  option: string;
}

/** Client-measured total ms plus the server-measured upstream ms. */
export interface Timing {
  totalMs: number;
  upstreamMs: number;
}

async function fail(res: Response): Promise<never> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (body.error) message = body.error;
  } catch {
    // non-JSON error body; keep the status text
  }
  throw new Error(message);
}

export async function fetchCatalog(): Promise<Catalog> {
  const res = await fetch("/api/providers");
  if (!res.ok) await fail(res);
  return res.json();
}

export async function transcribe(
  audio: Blob,
  sel: Selection,
): Promise<{ text: string; timing: Timing }> {
  const form = new FormData();
  const ext = audio.type.includes("mp4") ? "m4a" : "webm";
  form.append("provider", sel.provider);
  form.append("option", sel.option);
  form.append("audio", new File([audio], `utterance.${ext}`, { type: audio.type }));
  const t0 = performance.now();
  const res = await fetch("/api/stt", { method: "POST", body: form });
  if (!res.ok) await fail(res);
  const json = await res.json();
  return { text: json.text, timing: { totalMs: performance.now() - t0, upstreamMs: json.ms } };
}

export async function chat(
  messages: ChatMessage[],
  sel: Selection,
): Promise<{ text: string; timing: Timing }> {
  const t0 = performance.now();
  const res = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, ...sel }),
  });
  if (!res.ok) await fail(res);
  const json = await res.json();
  return { text: json.text, timing: { totalMs: performance.now() - t0, upstreamMs: json.ms } };
}

export async function speak(
  text: string,
  sel: Selection,
  signal?: AbortSignal,
): Promise<{ audio: Blob; timing: Timing }> {
  const t0 = performance.now();
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...sel }),
    signal,
  });
  if (!res.ok) await fail(res);
  const audio = await res.blob();
  return {
    audio,
    timing: {
      totalMs: performance.now() - t0,
      upstreamMs: Number(res.headers.get("X-Upstream-Ms") ?? 0),
    },
  };
}
