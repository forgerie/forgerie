import { afterEach, describe, expect, it, vi } from "vitest";
import { afterTranscriptPaint } from "./readPaint";
afterEach(() => vi.unstubAllGlobals());
function frames() {
  const pending = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => pending.delete(frame));
  return { pending, next: () => { for (const [frame, callback] of [...pending]) { pending.delete(frame); callback(0); } } };
}
describe("paint before acknowledging read", () => {
  it("waits across one paint boundary", async () => {
    const clock = frames();
    let settled = false;
    const paint = afterTranscriptPaint(new AbortController().signal).then(() => { settled = true; });
    clock.next(); await Promise.resolve(); expect(settled).toBe(false);
    clock.next(); await paint; expect(settled).toBe(true);
  });
  it("cancels its frame when the session closes", async () => {
    const clock = frames();
    const controller = new AbortController();
    const paint = afterTranscriptPaint(controller.signal);
    clock.next(); controller.abort(); await paint;
    expect(clock.pending.size).toBe(0);
  });
});
