export type StsServerMsg =
  | { type: "ready"; inputRate: number; outputRate: number }
  | { type: "audio"; data: string }
  | { type: "interrupted" }
  | { type: "transcript"; role: "user" | "agent"; text: string; final: boolean }
  | { type: "error"; message: string }
  | { type: "closed" };

export interface StsConnection {
  sendAudio(b64: string): void;
  close(): void;
}

export function connectSts(
  provider: string,
  model: string,
  onMessage: (msg: StsServerMsg) => void,
  onClose: () => void,
): StsConnection {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/api/sts?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`;
  const ws = new WebSocket(url);

  ws.onmessage = (evt) => {
    try {
      onMessage(JSON.parse(evt.data) as StsServerMsg);
    } catch {
      // ignore malformed messages
    }
  };
  ws.onclose = onClose;
  ws.onerror = () => {
    onMessage({ type: "error", message: "WebSocket connection failed" });
  };

  return {
    sendAudio(b64) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "audio", data: b64 }));
      }
    },
    close() {
      ws.onclose = null;
      ws.close();
      onClose();
    },
  };
}
