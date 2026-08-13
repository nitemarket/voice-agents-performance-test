export function play(audio: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(audio);
    const el = new Audio(url);
    const cleanup = () => URL.revokeObjectURL(url);
    el.onended = () => {
      cleanup();
      resolve();
    };
    el.onerror = () => {
      cleanup();
      reject(new Error("Audio playback failed"));
    };
    el.play().catch((err) => {
      cleanup();
      reject(err);
    });
  });
}
