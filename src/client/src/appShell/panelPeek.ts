import type { ShellPanel } from "./panelIntent";

/**
 * A peek is a look at a panel, not a decision about it.
 *
 * The sheet follows the finger, so a look can be abandoned halfway at no cost.
 * That is what lets the gesture live anywhere on the surface instead of on an
 * edge: a drag that was not meant is undone by letting go.
 *
 * A peek never writes {@link PanelIntent}. Only the pin inside an open sheet
 * does that. Without the split, one accidental drag would follow the user to
 * every device.
 */
/**
 * Which way a drag is taking the sheet.
 *
 * Part of the state because the answer cannot be recovered from the travel: a
 * drag that pulls a sheet in and a drag that pushes it back both run along the
 * same axis, and only where they started tells them apart. Without it, the
 * second move of a retreat reads as an opening drag running backwards, and the
 * sheet collapses under the finger.
 */
export type PeekGesture = "opening" | "closing";

export type PanelPeek =
  | { readonly kind: "closed" }
  /** A finger is down and the sheet is at `progress` of its width. */
  | { readonly kind: "tracking"; readonly panel: ShellPanel; readonly progress: number; readonly gesture: PeekGesture }
  /**
   * The sheet is on its way out and still on screen.
   *
   * A separate case because leaving takes time. Without it the sheet is taken
   * out of the document the instant it is dismissed, and a thing that arrived
   * by following a finger vanishes instead of going back the way it came.
   */
  | { readonly kind: "closing"; readonly panel: ShellPanel }
  | { readonly kind: "open"; readonly panel: ShellPanel };

export const PEEK_CLOSED: PanelPeek = { kind: "closed" };

export interface PeekConfig {
  /** Travel before a drag stops belonging to the surface under it. */
  readonly capturePx: number;
  /** How far from horizontal a drag may wander and still summon a panel. */
  readonly maxAngleDegrees: number;
  /** Share of the sheet that has to show before letting go opens it. */
  readonly commitFraction: number;
}

/**
 * The angle is generous because a thumb travels in an arc, not a line. The
 * capture distance is short because the sheet follows the finger from the
 * moment it captures, and an early follow reads as responsive rather than
 * twitchy.
 */
export const PANEL_PEEK: PeekConfig = { capturePx: 10, maxAngleDegrees: 30, commitFraction: 0.4 };

/**
 * How wide a peeked sheet is.
 *
 * It stops short of the full surface so the session stays visible behind it:
 * the sheet is a look at something else, and the thing it covers is the reason
 * the reader is here. The renderer sets this width on the element, so the
 * arithmetic and the layout cannot drift apart.
 */
export function peekSheetWidth(shellWidthPx: number): number {
  if (!Number.isFinite(shellWidthPx) || shellWidthPx <= 0) return 0;
  return Math.min(360, Math.round(shellWidthPx * 0.85));
}

export interface PeekTrackInput {
  readonly current: PanelPeek;
  /** Travel since the finger went down. Positive is rightward. */
  readonly dx: number;
  readonly dy: number;
  /** Width of the sheet being pulled, in the same pixels as `dx`. */
  readonly sheetWidthPx: number;
  /** Whether a panel can be peeked at all. A docked panel is already there. */
  readonly peekable: (panel: ShellPanel) => boolean;
  readonly config: PeekConfig;
}

/**
 * Where a drag has taken the sheet.
 *
 * The panel is chosen once, at capture, and held for the rest of the drag: a
 * finger that crosses back over its own start must not swap sheets mid-gesture.
 */
export function trackPeek(input: PeekTrackInput): PanelPeek {
  const { current, dx, dy, sheetWidthPx } = input;
  if (sheetWidthPx <= 0) return current;

  if (current.kind === "open") return trackClosing(current.panel, dx, sheetWidthPx);
  if (current.kind === "tracking" && current.gesture === "closing") return trackClosing(current.panel, dx, sheetWidthPx);

  const panel = current.kind === "tracking" ? current.panel : capturedPanel(dx, dy, input);
  if (panel === undefined) return current;

  const travel = panel === "navigation" ? dx : -dx;
  if (travel <= 0) return current.kind === "tracking" ? { kind: "tracking", panel, progress: 0, gesture: "opening" } : current;
  return { kind: "tracking", panel, progress: clampFraction(travel / sheetWidthPx), gesture: "opening" };
}

/** What letting go leaves on screen. A look that fell short leaves by sliding. */
export function releasePeek(current: PanelPeek, config: PeekConfig): PanelPeek {
  if (current.kind !== "tracking") return current;
  return current.progress >= config.commitFraction
    ? { kind: "open", panel: current.panel }
    : { kind: "closing", panel: current.panel };
}

/** How far the sheet is pulled, for the renderer. Open counts as fully pulled. */
export function peekProgress(peek: PanelPeek, panel: ShellPanel): number {
  if (peek.kind === "open") return peek.panel === panel ? 1 : 0;
  if (peek.kind === "tracking") return peek.panel === panel ? peek.progress : 0;
  return 0;
}

export function peekedPanel(peek: PanelPeek): ShellPanel | undefined {
  return peek.kind === "closed" ? undefined : peek.panel;
}

/** How long a dismissed sheet stays mounted while it slides out. Matches the CSS. */
export const PEEK_EXIT_MS = 180;

/**
 * A drag back across the sheet pushes it out, and letting go part-way lets it
 * fall back to whichever end it is nearer. Travel is measured from where the
 * finger went down, so reversing mid-gesture pulls the sheet open again rather
 * than ending the gesture.
 */
function trackClosing(panel: ShellPanel, dx: number, sheetWidthPx: number): PanelPeek {
  const backwards = panel === "navigation" ? -dx : dx;
  if (backwards <= 0) return { kind: "tracking", panel, progress: 1, gesture: "closing" };
  return { kind: "tracking", panel, progress: clampFraction(1 - backwards / sheetWidthPx), gesture: "closing" };
}

/**
 * Which panel this drag summons, or nothing when the drag is not the shell's.
 *
 * Two tests, both cheap: it must travel far enough to be deliberate, and it
 * must be near enough to horizontal that it is not a scroll with a wobble.
 */
function capturedPanel(dx: number, dy: number, input: PeekTrackInput): ShellPanel | undefined {
  const across = Math.abs(dx);
  if (across < input.config.capturePx) return undefined;
  if (angleFromHorizontal(dx, dy) > input.config.maxAngleDegrees) return undefined;

  const panel: ShellPanel = dx > 0 ? "navigation" : "workspace";
  return input.peekable(panel) ? panel : undefined;
}

function angleFromHorizontal(dx: number, dy: number): number {
  return Math.abs(Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI));
}

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value));
}
