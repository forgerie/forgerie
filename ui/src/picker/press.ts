// What a touch press on a row asked for. Ported from the Lit client's
// rowPress.ts so both clients read a hold the same way: hold opens the row's
// commands, tap opens the session, travel means the finger was scrolling.

/** A finger rests on a few pixels of movement even when held still, so the tolerance is generous. */
export const ROW_PRESS = { holdMs: 500, moveTolerancePx: 10 } as const;
export type RowPressOutcome = "commands" | "select" | "abandoned";

export function readRowPress(movedPx: number, heldMs: number, config: { holdMs: number; moveTolerancePx: number } = ROW_PRESS): RowPressOutcome {
  if (movedPx > config.moveTolerancePx) return "abandoned";
  return heldMs >= config.holdMs ? "commands" : "select";
}
