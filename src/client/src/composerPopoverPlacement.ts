/** Where an anchored composer popover sits, in the host island's own pixels. */
export interface ComposerPopoverPlacementInput {
  /** The control that opened the panel, relative to the host's left edge. */
  readonly anchor: { readonly left: number; readonly width: number };
  /**
   * Room the panel has outside the island, in viewport pixels.
   *
   * A panel may overflow the island, so the island's own height says nothing
   * about whether it fits. Only the space above and below the rail does.
   */
  readonly space: { readonly above: number; readonly below: number };
  /** The island the panel is anchored to. */
  readonly host: { readonly width: number };
  /** The panel's own content size, before any clamping. */
  readonly panel: { readonly width: number; readonly height: number };
  /** Space between the panel and its control. */
  readonly gap?: number;
  /** Smallest distance kept between the panel and the island's edges. */
  readonly inset?: number;
  /** The widest a panel may ever be, whatever its content. */
  readonly maxWidth?: number;
}

export interface ComposerPopoverPlacement {
  readonly side: "above" | "below";
  readonly left: number;
  readonly width: number;
}

const DEFAULT_GAP = 8;
const DEFAULT_INSET = 8;
const DEFAULT_MAX_WIDTH = 348;

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

  const available = Math.max(0, input.host.width - inset * 2);
  const width = Math.min(input.panel.width, maxWidth, available);

  // Prefer the control's own left edge; pull back only to stay inside.
  const rightMost = Math.max(inset, input.host.width - inset - width);
  const left = Math.min(Math.max(input.anchor.left, inset), rightMost);

  const needed = input.panel.height + gap;
  const side = input.space.above >= needed || input.space.above >= input.space.below ? "above" : "below";
  return { side, left, width };
}
