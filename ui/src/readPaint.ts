/** Let React commit history and the browser paint it before a read acknowledgement. */
export function afterTranscriptPaint(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let frame: number;
    const done = () => {
      cancelAnimationFrame(frame);
      signal.removeEventListener("abort", done);
      resolve();
    };
    signal.addEventListener("abort", done, { once: true });
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(done); });
  });
}
