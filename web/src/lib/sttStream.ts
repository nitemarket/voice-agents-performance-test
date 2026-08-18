import { MicStream, type VadCallbacks } from "./audioStream";

// Live transcription session for the pipeline tab's hands-free mode: keeps the
// mic and a server STT bridge open across turns; finalizeTurn() commits the
// current utterance and the session keeps listening.

export interface LiveSttHandlers {
  onPartial: (text: string) => void;
  /** Per turn: the committed transcript and the server-side finalize latency. */
  onFinal: (text: string, ms: number) => void;
  onError: (message: string) => void;
  /** Server or upstream closed the session. */
  onClosed: () => void;
}

export interface LiveSttSession {
  finalizeTurn(): void;
  close(): void;
}

export function startLiveStt(
  provider: string,
  handlers: LiveSttHandlers,
  vad: VadCallbacks,
): Promise<LiveSttSession> {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${location.host}/api/stt/stream?provider=${encodeURIComponent(provider)}`,
    );
    const mic = new MicStream();
    let live = false;

    const cleanup = () => {
      mic.stop();
      ws.onclose = null;
      ws.close();
    };

    ws.onmessage = (evt) => {
      let msg: any;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case "ready":
          mic
            .start(
              msg.inputRate,
              (b64) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "audio", data: b64 }));
                }
              },
              vad,
            )
            .then(() => {
              live = true;
              resolve({
                finalizeTurn() {
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: "finalize" }));
                  }
                },
                close: cleanup,
              });
            })
            .catch(() => {
              cleanup();
              reject(new Error("Microphone access denied or unavailable"));
            });
          break;
        case "partial":
          handlers.onPartial(msg.text);
          break;
        case "final":
          handlers.onFinal(msg.text, msg.ms);
          break;
        case "error":
          if (live) {
            handlers.onError(msg.message);
          } else {
            cleanup();
            reject(new Error(msg.message));
          }
          break;
      }
    };
    ws.onclose = () => {
      mic.stop();
      if (live) {
        handlers.onClosed();
      } else {
        reject(new Error("STT stream connection failed"));
      }
    };
  });
}
