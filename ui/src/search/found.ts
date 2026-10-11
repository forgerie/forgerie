import type { FoundState, SessionSearchActions } from "./sessionSearch";

/**
 * What an open session needs from the hit the reader opened. While its
 * place is being read, or when it cannot be shown, the match bar says so.
 * A message on the current branch is marked and scrolled to, with steps to
 * the session's other matches. An entry off the branch opens the history tree.
 */
export type FoundBinding = { key: number; onClose: () => void; onRetry: () => void } & (
  | { type: "pending"; state: { type: "loading" } | { type: "failed"; message: string } | { type: "missing" } }
  | { type: "message"; positions: readonly number[]; current: number; onStep: (delta: 1 | -1) => void }
  | { type: "entry"; entryId: string; onOpened: () => void });

export function foundBinding(found: FoundState, actions: SessionSearchActions): FoundBinding {
  const base = { key: found.key, onClose: actions.closeFound, onRetry: actions.retryMatches };
  const { place } = found;
  if (place.type === "entry") return { ...base, type: "entry", entryId: place.entryId, onOpened: actions.closeFound };
  if (place.type === "message") return { ...base, type: "message", positions: place.list.map((match) => match.position), current: place.current, onStep: actions.step };
  return { ...base, type: "pending", state: place };
}

/** What the match bar says. */
export type MatchBarView =
  | { type: "loading" }
  | { type: "failed"; message: string }
  /** The session no longer holds the opened passage. */
  | { type: "missing" }
  /** The history tree for an off-branch hit could not be read or opened. */
  | { type: "treeFailed"; message: string }
  | { type: "ready"; current: number; total: number; missing: boolean }
  /** An off-branch hit in a session at work: the tree waits. */
  | { type: "waiting" };
