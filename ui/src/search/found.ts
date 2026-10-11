import type { FoundState, SessionSearchActions } from "./sessionSearch";

/**
 * What an open session needs from the hit the reader opened. A message hit
 * marks and scrolls to one message and steps through the others; an entry
 * hit is off the current branch and opens the history tree at it.
 */
export type FoundBinding =
  | {
    type: "message"; key: number;
    matches: { type: "loading" } | { type: "failed"; message: string } | { type: "ready"; positions: readonly number[]; current: number };
    onStep: (delta: 1 | -1) => void; onRetry: () => void; onClose: () => void;
  }
  | { type: "entry"; key: number; entryId: string; onOpened: () => void; onClose: () => void };

export function foundBinding(found: FoundState, actions: SessionSearchActions): FoundBinding {
  if (found.type === "entry") return { type: "entry", key: found.key, entryId: found.hit.passage.entryId, onOpened: actions.closeFound, onClose: actions.closeFound };
  const { matches } = found;
  return {
    type: "message", key: found.key, onStep: actions.step, onRetry: actions.retryMatches, onClose: actions.closeFound,
    matches: matches.type === "ready" ? { type: "ready", positions: matches.list.map((match) => match.position), current: matches.current } : matches,
  };
}

/** What the match bar says. */
export type MatchBarView =
  | { type: "loading" }
  | { type: "failed"; message: string }
  | { type: "ready"; current: number; total: number; missing: boolean }
  /** An off-branch hit in a session at work: the tree waits. */
  | { type: "waiting" }
  | { type: "readOnly" };
