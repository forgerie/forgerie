import type { ModelChains } from "@shared/modelChains";
import { parseModelReference } from "@shared/thinkingLevels";
import type { ReactNode } from "react";
import type { ChainWait, SessionModel } from "../contracts";

/** What the session gives the line that shows a chain's wait. */
export interface ChainWaitView {
  wait: ChainWait;
  /** The chain the session runs on. */
  chain?: string | undefined;
  /** The session's models, for their names. */
  models: readonly SessionModel[];
  /** Ends the run, and the wait with it. Absent while the input bar shows its own Stop. */
  onStop?: (() => void) | undefined;
}
/** Draws a chain's wait with the app's chains, so it can name the model that comes next. */
export type ChainWaitRenderer = (view: ChainWaitView) => ReactNode;

/** Milliseconds left in a chain's wait at `now`; never below zero. */
export const chainWaitLeft = (wait: Pick<ChainWait, "until">, now: number): number => Math.max(0, wait.until - now);

/** Time left as a clock, rounded up to the second: 42 s reads "0:42", 61 s "1:01". */
export function chainWaitClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1_000));
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The chain's entry after the one it waits for, as a guess at where it moves next: the server may skip an entry that
 * is cooling down. Undefined when the chain is unknown, `from` is not in it, or `from` is its last entry.
 */
export function nextChainEntry(chains: ModelChains | undefined, chain: string | undefined, from: string): string | undefined {
  const entries = chain !== undefined && chains && Object.hasOwn(chains, chain) ? chains[chain] : undefined;
  if (!entries) return undefined;
  const key = parseModelReference(from).model;
  const index = entries.findIndex((entry) => parseModelReference(entry).model === key);
  return index < 0 ? undefined : entries[index + 1];
}
