/**
 * What the transcript holds still while its content changes.
 *
 * A single "pinned to bottom" boolean could only say *follow the foot* or
 * *leave it alone*, and the reading position a conversation actually wants is a
 * third thing: when a turn opens, its opening message goes to the top of the
 * viewport and stays there while the reply streams in underneath. Naming the
 * three cases keeps the choice in one place instead of spread across the scroll
 * handlers as an ever-growing pair of booleans.
 */
export type ChatFollowMode =
  | { readonly kind: "tail" }
  | { readonly kind: "turn"; readonly turnKey: string }
  | { readonly kind: "free" };

/** Follow the foot of the transcript: new content scrolls into view. */
export const FOLLOW_TAIL: ChatFollowMode = { kind: "tail" };

/** Hold the position the reader chose: nothing moves the scroller. */
export const FOLLOW_FREE: ChatFollowMode = { kind: "free" };

/** Hold the head of one turn at the top of the viewport. */
export function followTurn(turnKey: string): ChatFollowMode {
  return { kind: "turn", turnKey };
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
 * bottom" and would otherwise hand the transcript straight back to the tail --
 * and the tail would then chase the reply the anchor exists to hold still.
 */
export function followModeAfterScroll(mode: ChatFollowMode, scroll: ChatScrollSnapshot, driver: ChatScrollDriver): ChatFollowMode {
  if (mode.kind === "turn" && driver === "component") return mode;
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
 * A reader who has scrolled away keeps their place: a turn arriving from
 * another device is not a reason to move them. Their own send is, which is what
 * `sentFromHere` reports.
 */
export function followModeAfterTurnOpened(mode: ChatFollowMode, turnKey: string, sentFromHere: boolean): ChatFollowMode {
  if (mode.kind === "free" && !sentFromHere) return mode;
  return followTurn(turnKey);
}

/** Whether the transcript should keep the given turn's head at the top of the viewport. */
export function anchoredTurnKey(mode: ChatFollowMode): string | undefined {
  return mode.kind === "turn" ? mode.turnKey : undefined;
}
