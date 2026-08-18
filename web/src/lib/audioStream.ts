// Audio plumbing for the speech-to-speech page: continuous mic capture to
// base64 PCM16 chunks, and gapless streaming playback of PCM16 chunks.

const WORKLET_SRC = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffers = [];
    this.length = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      this.buffers.push(new Float32Array(channel));
      this.length += channel.length;
      // ~100ms per chunk at 24kHz (2400 samples); fine at 16kHz too (150ms)
      if (this.length >= 2400) {
        const all = new Float32Array(this.length);
        let offset = 0;
        for (const b of this.buffers) {
          all.set(b, offset);
          offset += b.length;
        }
        this.port.postMessage(all, [all.buffer]);
        this.buffers = [];
        this.length = 0;
      }
    }
    return true;
  }
}
registerProcessor("capture", CaptureProcessor);
`;

function floatToPcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function pcm16Base64ToFloat(b64: string): Float32Array<ArrayBuffer> {
  const binary = atob(b64);
  const samples = new Float32Array(Math.floor(binary.length / 2));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return samples;
}

export interface VadCallbacks {
  /** User started speaking (rough, energy-based). */
  onSpeechStart?: () => void;
  /** User stopped speaking; ts is the performance.now() of the last voiced frame. */
  onSpeechEnd?: (ts: number) => void;
}

// Energy-based VAD tuning: RMS above threshold = voice; speech ends after
// HANGOVER_MS of silence. Approximate by design — used for latency metrics,
// not turn-taking (the provider's VAD does that).
const VAD_THRESHOLD = 0.015;
const VAD_HANGOVER_MS = 400;

export class MicStream {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  muted = false;
  private speaking = false;
  private lastVoiceTs = 0;

  private updateVad(samples: Float32Array, vad: VadCallbacks): void {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    const now = performance.now();
    if (rms >= VAD_THRESHOLD) {
      if (!this.speaking) {
        this.speaking = true;
        vad.onSpeechStart?.();
      }
      this.lastVoiceTs = now;
    } else if (this.speaking && now - this.lastVoiceTs > VAD_HANGOVER_MS) {
      this.speaking = false;
      vad.onSpeechEnd?.(this.lastVoiceTs);
    }
  }

  async start(
    sampleRate: number,
    onChunk: (b64: string) => void,
    vad: VadCallbacks = {},
  ): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    this.ctx = new AudioContext({ sampleRate });
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = this.ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(this.ctx, "capture");
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (this.muted) return;
      this.updateVad(e.data, vad);
      onChunk(floatToPcm16Base64(e.data));
    };
    source.connect(node);
    node.connect(this.ctx.destination); // processor emits silence; keeps the graph alive
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}

export class StreamPlayer {
  private ctx: AudioContext;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor(sampleRate: number) {
    this.ctx = new AudioContext({ sampleRate });
  }

  /** Whether agent audio is currently playing or queued. */
  get playing(): boolean {
    return this.sources.size > 0;
  }

  push(b64: string): void {
    const samples = pcm16Base64ToFloat(b64);
    if (samples.length === 0) return;
    const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    const startAt = Math.max(this.ctx.currentTime + 0.05, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  /** Stop everything queued — used on barge-in. */
  flush(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.sources.clear();
    this.nextTime = 0;
  }

  close(): void {
    this.flush();
    void this.ctx.close();
  }
}
