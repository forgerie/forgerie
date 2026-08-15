/**
 * The variant registry — the one documented entry surface for this folder.
 *
 * Order runs from the most gestural to the most explicit: Discs is nearly pure
 * muscle memory, Column is nearly pure reading. Radial and Knob sit off that
 * line — Radial trades visibility for directions that never move, Knob trades
 * speed for a list that no screen size can cap.
 */

import { column } from "./column.js";
import { discs } from "./discs.js";
import { knob } from "./knob.js";
import { labels } from "./labels.js";
import { radial } from "./radial.js";

export const VARIANTS = [discs, labels, radial, column, knob];

/**
 * Radial, because it is the chosen design — and because Discs cannot seat the
 * chosen eight slots on the cover screen, so defaulting to it produced a press
 * that silently did nothing there.
 */
export const DEFAULT_VARIANT = radial.id;

export function variantById(id) {
  return VARIANTS.find((variant) => variant.id === id) ?? VARIANTS[0];
}
