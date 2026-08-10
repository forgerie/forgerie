/**
 * The arithmetic of a leftward swipe on a list row.
 *
 * The browser keeps the vertical scroll when the row sets `touch-action:
 * pan-y`, so this code never competes with the scroll. It decides two other
 * things: whether a movement is a swipe at all, and whether the swipe has gone
 * far enough to act.
 */
export interface SwipeConfig {
  /** Travel before a movement counts as a swipe rather than a touch. */
  readonly engagePx: number;
  /** Travel before the swipe archives the row on release. */
  readonly commitPx: number;
}

export interface SwipeReading {
  /** How far the row moves. Zero, or a negative number for leftward travel. */
  readonly offset: number;
  /** True when the movement is a swipe, so the row must not take a tap. */
  readonly engaged: boolean;
  /** True when a release at this point archives the row. */
  readonly willArchive: boolean;
}

const AT_REST: SwipeReading = { offset: 0, engaged: false, willArchive: false };

/**
 * Read a movement from the point where the finger went down.
 *
 * A movement engages when it travels far enough and travels more across than
 * down. The second test protects the scroll: a finger that goes down the list
 * moves a few pixels across as well, and that must not open a row.
 *
 * Only leftward travel moves the row. A rightward drag reads as zero, because
 * the row has one action and it sits on one side.
 */
export function readSwipe(dx: number, dy: number, config: SwipeConfig): SwipeReading {
  const across = Math.abs(dx);
  if (across < config.engagePx || across <= Math.abs(dy)) return AT_REST;

  const offset = Math.min(0, dx);
  return { offset, engaged: true, willArchive: -offset >= config.commitPx };
}

/**
 * How far a row of this width must travel before a release archives it.
 *
 * The travel is a share of the row, so a narrow cover screen and a wide
 * unfolded screen both ask for the same gesture. The limits stop a very narrow
 * row from arming on a twitch, and stop a very wide row from asking for a
 * stretch across the whole panel.
 */
export function commitDistance(rowWidth: number): number {
  const share = rowWidth * 0.35;
  return Math.min(140, Math.max(64, share));
}
