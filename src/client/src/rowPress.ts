/**
 * What a press on a list row asked for.
 *
 * Horizontal travel belongs to the shell, which pulls its side panels in, so a
 * row reads only how long a finger stayed and how far it wandered. That leaves
 * one meaning per gesture: drag across moves the shell, hold opens the row's
 * commands, tap opens the session.
 */
export interface RowPressConfig {
  /** How long a finger must stay still before the row offers its commands. */
  readonly holdMs: number;
  /** Travel allowed during a hold. Beyond it the press was a scroll. */
  readonly moveTolerancePx: number;
}

/**
 * A finger rests on a few pixels of movement even when its owner means to hold
 * still, and a list scrolls under it, so the tolerance is generous and the hold
 * is long enough to be deliberate.
 */
export const ROW_PRESS: RowPressConfig = { holdMs: 500, moveTolerancePx: 10 };

export type RowPressOutcome =
  /** Open this row's commands. */
  | "commands"
  /** Open the session. */
  | "select"
  /** The press belonged to something else, usually the scroll. */
  | "abandoned";

export function readRowPress(movedPx: number, heldMs: number, config: RowPressConfig): RowPressOutcome {
  if (movedPx > config.moveTolerancePx) return "abandoned";
  return heldMs >= config.holdMs ? "commands" : "select";
}

/** Straight-line travel from where the finger went down. */
export function pressTravel(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}
