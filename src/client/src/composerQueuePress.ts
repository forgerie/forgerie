import { ROW_PRESS, pressTravel, readRowPress } from "./rowPress";

export const COMPOSER_QUEUE_HOLD_MS = ROW_PRESS.holdMs;
export const COMPOSER_QUEUE_MOVE_TOLERANCE_PX = ROW_PRESS.moveTolerancePx;

export type ComposerQueuePressOutcome = "queue" | "steer" | "abandoned";

export function readComposerQueuePress(movedPx: number, heldMs: number): ComposerQueuePressOutcome {
  const outcome = readRowPress(movedPx, heldMs, ROW_PRESS);
  if (outcome === "commands") return "steer";
  if (outcome === "select") return "queue";
  return "abandoned";
}

export function composerQueuePressTravel(dx: number, dy: number): number {
  return pressTravel(dx, dy);
}

export function isPrimaryQueuePointerPress(event: Pick<PointerEvent, "button">): boolean {
  return event.button === 0;
}

export function isQueueHoldKey(event: Pick<KeyboardEvent, "key">): boolean {
  return event.key === " " || event.key === "Enter";
}
