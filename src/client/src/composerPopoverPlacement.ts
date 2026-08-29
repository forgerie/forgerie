/** Where an anchored composer popover sits, in the host island's own pixels. */
export interface ComposerPopoverPlacementInput {
  /** The control that opened the panel, relative to the host's left edge. */
  readonly anchor: { readonly left: number; readonly width: number; readonly top?: number; readonly bottom?: number };
  /**
   * Room the panel has outside the island, in viewport pixels.
   *
   * A panel may overflow the island, so the island's own height says nothing
   * about whether it fits. Only the space above and below the rail does.
   */
  readonly space: { readonly above: number; readonly below: number };
  /** The island the panel is anchored to. */
  readonly host: { readonly width: number; readonly height?: number };
  /**
   * The panel's own height, used only to decide which side it opens on.
   *
   * Its width is deliberately not an input: a panel that is measured and then
   * set to its own measurement collapses, because the measurement is taken
   * after the constraint has already been applied.
   */
  readonly panel: { readonly height: number };
  /** Space between the panel and its control. */
  readonly gap?: number;
  /** Smallest distance kept between the panel and the island's edges. */
  readonly inset?: number;
  /** The widest a panel may ever be, whatever its content. */
  readonly maxWidth?: number;
  /** The tallest a panel may ever be before its choices scroll. */
  readonly maxHeight?: number;
}

export interface ComposerPopoverPlacement {
  readonly side: "above" | "below";
  readonly left: number;
  /** A ceiling, not a size. The panel is sized by its own content. */
  readonly maxWidth: number;
  /** Viewport-capped height; content scrolls inside this ceiling. */
  readonly maxHeight: number;
  /** Distance from the host edge on the selected side, when vertical geometry is available. */
  readonly verticalOffset?: number;
}

const DEFAULT_GAP = 8;
const DEFAULT_INSET = 8;
const DEFAULT_MAX_WIDTH = 348;
const DEFAULT_MAX_HEIGHT = 320;

/**
 * Decide where an anchored panel goes.
 *
 * Opening upward is the default: the rail sits at the bottom of the island, so
 * a panel above it covers the prompt rather than the controls that must stay
 * reachable. It flips rather than shrinking, so a panel is never made
 * unreadable in order to fit.
 */
export function composerPopoverPlacement(input: ComposerPopoverPlacementInput): ComposerPopoverPlacement {
  const gap = input.gap ?? DEFAULT_GAP;
  const inset = input.inset ?? DEFAULT_INSET;
  const maxWidth = input.maxWidth ?? DEFAULT_MAX_WIDTH;
  const maxHeight = input.maxHeight ?? DEFAULT_MAX_HEIGHT;

  const available = Math.max(0, input.host.width - inset * 2);
  const ceiling = Math.min(maxWidth, available);

  // Prefer the control's own left edge, and leave room for a panel that uses
  // the whole ceiling, so a wide panel never overhangs the island.
  const rightMost = Math.max(inset, input.host.width - inset - ceiling);
  const left = Math.min(Math.max(input.anchor.left, inset), rightMost);

  const needed = input.panel.height + gap;
  const side = input.space.above >= needed || input.space.above >= input.space.below ? "above" : "below";
  const selectedSpace = side === "above" ? input.space.above : input.space.below;
  const heightCeiling = Math.min(maxHeight, Math.max(0, selectedSpace - gap - inset));
  const anchorEdge = side === "above" ? input.anchor.top : input.anchor.bottom;
  const verticalOffset = anchorEdge === undefined || input.host.height === undefined
    ? undefined
    : side === "above"
      ? input.host.height - anchorEdge + gap
      : anchorEdge + gap;
  return { side, left, maxWidth: ceiling, maxHeight: heightCeiling, ...(verticalOffset === undefined ? {} : { verticalOffset }) };
}
