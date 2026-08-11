import type { ChatTranscriptPersistScheduler } from "./chatTranscriptStore";

export class ManualPersistScheduler implements ChatTranscriptPersistScheduler {
  private nextId = 1;
  readonly frames = new Map<number, () => void>();
  readonly timers = new Map<number, () => void>();
  readonly cancelledFrames: number[] = [];
  readonly clearedTimers: number[] = [];

  requestAnimationFrame(callback: () => void): number {
    const id = this.nextId;
    this.nextId += 1;
    this.frames.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id: number): void {
    this.cancelledFrames.push(id);
    this.frames.delete(id);
  }

  setTimeout(callback: () => void, delayMs: number): number {
    void delayMs;
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, callback);
    return id;
  }

  clearTimeout(id: number): void {
    this.clearedTimers.push(id);
    this.timers.delete(id);
  }

  flushFrames(): void {
    const callbacks = [...this.frames.entries()];
    this.frames.clear();
    for (const [, callback] of callbacks) callback();
  }

  flushTimers(): void {
    const callbacks = [...this.timers.entries()];
    this.timers.clear();
    for (const [, callback] of callbacks) callback();
  }

  flush(): void {
    this.flushFrames();
    this.flushTimers();
  }
}
