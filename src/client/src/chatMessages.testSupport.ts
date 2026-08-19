import type { ChatNormalizationScheduler } from "./chatMessages";

export interface ControllableChatNormalizationSchedulerOptions {
  elapsedPerReadMs?: number | undefined;
  pauseFirstYield?: boolean | undefined;
}

export class ControllableChatNormalizationScheduler implements ChatNormalizationScheduler {
  yieldCount = 0;
  private readonly elapsedPerReadMs: number;
  private pauseNext: boolean;
  private releasePausedYield: (() => void) | undefined;
  private time = 0;

  constructor(options: ControllableChatNormalizationSchedulerOptions = {}) {
    this.elapsedPerReadMs = options.elapsedPerReadMs ?? 6;
    this.pauseNext = options.pauseFirstYield === true;
  }

  now(): number {
    this.time += this.elapsedPerReadMs;
    return this.time;
  }

  yield(): Promise<void> {
    this.yieldCount += 1;
    if (!this.pauseNext) return Promise.resolve();
    this.pauseNext = false;
    return new Promise((resolve) => { this.releasePausedYield = resolve; });
  }

  pauseNextYield(): void {
    this.pauseNext = true;
  }

  release(): void {
    this.releasePausedYield?.();
    this.releasePausedYield = undefined;
  }
}
