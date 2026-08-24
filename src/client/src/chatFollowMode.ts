import type { ChatAnchorReadingPosition } from "./chatReadingPosition";

/** What the transcript holds still while its content changes. */
export type ChatFollowMode =
  | { readonly kind: "tail" }
  | { readonly kind: "turn"; readonly turnKey: string }
  | { readonly kind: "anchor"; readonly position: ChatAnchorReadingPosition }
  | { readonly kind: "free" };

/** Follow the foot of the transcript: new content scrolls into view. */
export const FOLLOW_TAIL: ChatFollowMode = { kind: "tail" };

/** Hold the position the reader chose: nothing moves the scroller. */
export const FOLLOW_FREE: ChatFollowMode = { kind: "free" };

/** Hold the head of one turn at the top of the viewport. */
export function followTurn(turnKey: string): ChatFollowMode {
  return { kind: "turn", turnKey };
}

/** Hold a saved passage at its recorded viewport offset. */
export function followAnchor(position: ChatAnchorReadingPosition): ChatFollowMode {
  return { kind: "anchor", position };
}

/** Where the scroller is, as the follow decision needs to see it. */
export interface ChatScrollSnapshot {
  readonly atBottom: boolean;
  readonly nearBottom: boolean;
  readonly scrollingUp: boolean;
}

/** Who moved the scroller: the reader, or the transcript itself. */
export type ChatScrollDriver = "reader" | "component";

/**
 * The mode after the scroller moved.
 *
 * An anchored turn ignores its own alignment. Aligning a turn to the top puts
 * the scroller at the foot of the reserved space, which reads as "at the
 * bottom" and would otherwise hand the transcript straight back to the tail.
 */
export function followModeAfterScroll(mode: ChatFollowMode, scroll: ChatScrollSnapshot, driver: ChatScrollDriver): ChatFollowMode {
  if ((mode.kind === "turn" || mode.kind === "anchor") && driver === "component") return mode;
  if (scroll.atBottom) return FOLLOW_TAIL;
  if (scroll.scrollingUp) return FOLLOW_FREE;
  return scroll.nearBottom ? FOLLOW_TAIL : FOLLOW_FREE;
}

/** The mode after the reader dragged, wheeled, or swiped the transcript upward. */
export function followModeAfterReaderPullback(mode: ChatFollowMode, canScrollUp: boolean): ChatFollowMode {
  return canScrollUp ? FOLLOW_FREE : mode;
}

/**
 * The mode after a turn opened at the foot of the transcript.
 *
 * A reader who has scrolled away keeps their place. Their own send takes the
 * reading position, which is what `sentFromHere` reports.
 */
export function followModeAfterTurnOpened(mode: ChatFollowMode, turnKey: string, sentFromHere: boolean): ChatFollowMode {
  if ((mode.kind === "free" || mode.kind === "anchor") && !sentFromHere) return mode;
  return followTurn(turnKey);
}

/** Whether the transcript should keep the given turn's head at the top of the viewport. */
export function anchoredTurnKey(mode: ChatFollowMode): string | undefined {
  return mode.kind === "turn" ? mode.turnKey : undefined;
}

/** The saved passage the transcript should keep at its recorded viewport offset. */
export function anchoredReadingPosition(mode: ChatFollowMode): ChatAnchorReadingPosition | undefined {
  return mode.kind === "anchor" ? mode.position : undefined;
}
