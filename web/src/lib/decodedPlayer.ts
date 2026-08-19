/**
 * Gapless playback queue for encoded audio blobs (mp3/wav): each enqueued blob
 * is decoded via Web Audio and scheduled back-to-back. Used by the streaming
 * pipeline to play per-sentence TTS chunks as they arrive.
 */
export class DecodedQueuePlayer {
  private ctx = new AudioContext();
  private nextTime = 0;
  private active = new Set<AudioBufferSourceNode>();
  /** Fires once, when the first chunk is scheduled. */
  onFirstAudio: (() => void) | null = null;

  async enqueue(blob: Blob): Promise<void> {
    // Contexts created outside a user gesture can start suspended — audio
    // would schedule silently. Resume before scheduling.
    if (this.ctx.state !== "running") {
      await this.ctx.resume().catch(() => {});
    }
    const buffer = await this.ctx.decodeAudioData(await blob.arrayBuffer());
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    const startAt = Math.max(this.ctx.currentTime + 0.05, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.active.add(source);
    source.onended = () => this.active.delete(source);
    if (this.onFirstAudio) {
      this.onFirstAudio();
      this.onFirstAudio = null;
    }
  }

  /** Stop and clear everything queued (barge-in); the player stays usable. */
  flush(): void {
    for (const source of this.active) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.active.clear();
    this.nextTime = 0;
    this.onFirstAudio = null;
  }

  /** Resolves when everything scheduled has finished playing. */
  async drain(): Promise<void> {
    while (this.active.size > 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  close(): void {
    this.flush();
    void this.ctx.close();
  }
}
