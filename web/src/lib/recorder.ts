const PREFERRED_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

export class Recorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  get isRecording() {
    return this.recorder?.state === "recording";
  }

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const recorder = this.recorder;
      if (!recorder || recorder.state !== "recording") {
        reject(new Error("Not recording"));
        return;
      }
      recorder.onstop = () => {
        recorder.stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" }));
      };
      recorder.stop();
    });
  }
}
