import type { ChainWait } from "../contracts";

/** Milliseconds left in a chain's wait at `now`; never below zero. */
export const chainWaitLeft = (wait: Pick<ChainWait, "until">, now: number): number => Math.max(0, wait.until - now);

/** Time left as a clock, rounded up to the second: 42 s reads "0:42", 61 s "1:01". */
export function chainWaitClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1_000));
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}
