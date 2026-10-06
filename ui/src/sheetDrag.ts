// A sideways drag that pulls the session sheet in from the left, or pushes it back.
// Pure. Ported from the Lit client's appShell/panelPeek.ts (main, 96d96310) with
// its acceptance-tuned numbers; this client has one sheet, so only the left side.

/**
 * Which way the drag moves the sheet. Part of the state: an opening drag that
 * reverses and a closing drag run along the same axis, and only where the drag
 * started tells them apart.
 */
export type SheetGesture = "opening" | "closing";
/** `idle`: no drag owns the sheet. `tracking`: the sheet shows `progress` of its width under the finger. */
export type SheetDrag = { type: "idle" } | { type: "tracking"; progress: number; gesture: SheetGesture };
export const SHEET_IDLE: SheetDrag = { type: "idle" };

export interface SheetDragConfig {
  /** Travel before a drag stops belonging to what is under it. */
  capturePx: number;
  /** How far from horizontal a drag may wander. A thumb moves in an arc. */
  maxAngleDegrees: number;
  /** Share of the sheet that must show before letting go keeps it open. Opening is a request. */
  commitFraction: number;
  /** Share of the sheet pushed back before letting go closes it. Closing is a correction, so it costs less. */
  dismissFraction: number;
}
/** The values the Lit client settled on after use on the Fold. Change them from a hand on glass. */
export const SHEET_DRAG: SheetDragConfig = { capturePx: 10, maxAngleDegrees: 30, commitFraction: 0.4, dismissFraction: 0.2 };

export interface SheetTrackInput {
  current: SheetDrag;
  /** Whether the sheet was open when the finger went down. */
  open: boolean;
  /** Travel since the finger went down. Positive is rightward. */
  dx: number;
  dy: number;
  /** Width of the sheet, in the same pixels as `dx`. Zero means not measured. */
  sheetWidthPx: number;
  config?: SheetDragConfig;
}

/** Where the drag has taken the sheet. A drag that is not the sheet's leaves it idle. */
export function trackSheet({ current, open, dx, dy, sheetWidthPx, config = SHEET_DRAG }: SheetTrackInput): SheetDrag {
  if (sheetWidthPx <= 0) return current;
  if (current.type === "idle" && !captures(dx, dy, config)) return current;
  if (open) {
    // Pushing back. Travel the other way pulls it open again rather than ending the drag.
    const back = -dx;
    if (current.type === "idle" && back <= 0) return current;
    return { type: "tracking", gesture: "closing", progress: clamp(1 - Math.max(0, back) / sheetWidthPx) };
  }
  if (current.type === "idle" && dx <= 0) return current;
  return { type: "tracking", gesture: "opening", progress: clamp(dx / sheetWidthPx) };
}

/** Whether letting go leaves the sheet open. Undefined when the drag never became the sheet's. */
export function releaseSheet(current: SheetDrag, config: SheetDragConfig = SHEET_DRAG): boolean | undefined {
  if (current.type === "idle") return undefined;
  return current.gesture === "closing" ? current.progress > 1 - config.dismissFraction : current.progress >= config.commitFraction;
}

/** Far enough to be meant, and near enough to horizontal not to be a scroll with a wobble. */
function captures(dx: number, dy: number, config: SheetDragConfig): boolean {
  return Math.abs(dx) >= config.capturePx && withinAngle(dx, dy, config);
}
/**
 * Near enough to horizontal for the sheet. The touch handler claims a drag on
 * this alone, before the capture distance, because the browser decides earlier.
 */
export function withinAngle(dx: number, dy: number, config: SheetDragConfig = SHEET_DRAG): boolean {
  if (dx === 0) return false;
  return Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI) <= config.maxAngleDegrees;
}
const clamp = (value: number) => Math.min(1, Math.max(0, value));
