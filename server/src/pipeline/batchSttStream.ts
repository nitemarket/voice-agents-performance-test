import { pcmToWav } from "./audio";
import type { SttProvider, SttStreamAdapter } from "./types";

/**
 * Pseudo-streaming for providers with only a batch STT API (e.g. Groq):
 * buffer the utterance's PCM in memory and run one batch transcription at
 * turn-commit. No partials while speaking, but with fast batch inference the
 * finalize latency stays low. This is the standard VAD-segmented pattern
 * production pipelines use for Whisper-class APIs.
 */
export function batchAsSttStream(impl: SttProvider, inputRate = 16000): SttStreamAdapter {
  return {
    inputRate,
    async stream({ model, onFinal, onError }) {
      let chunks: Buffer[] = [];
      return {
        sendAudio(b64) {
          chunks.push(Buffer.from(b64, "base64"));
        },
        finalizeTurn() {
          const pcm = Buffer.concat(chunks);
          chunks = [];
          // Ignore turns shorter than ~200ms of audio (VAD noise blips).
          if (pcm.length < inputRate * 0.2 * 2) {
            onFinal("");
            return;
          }
          void (async () => {
            try {
              const wav = pcmToWav(pcm, inputRate);
              const file = new File([wav], "turn.wav", { type: "audio/wav" });
              onFinal(await impl.transcribe(file, model));
            } catch (err) {
              onError(err instanceof Error ? err.message : String(err));
            }
          })();
        },
        close() {
          chunks = [];
        },
      };
    },
  };
}
