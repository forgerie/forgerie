/**
 * A table that does not fit the reading column stops being a table.
 *
 * Horizontal scrolling inside a transcript is the worst of both worlds: the
 * reader loses the first column as soon as they reach the last one, and on a
 * touch screen the gesture fights the transcript's own scroll. So a table that
 * is too wide for its column is laid out as one card per row instead, with each
 * cell carrying its column heading. The reader trades comparison across rows
 * for being able to read at all.
 *
 * The decision is a pure function of two widths, so it is the same on every
 * device and needs no breakpoints: the width the table wants, and the width the
 * column has. Nothing here asks what kind of device is showing it.
 */

/** How a table is laid out. `columns` is the table as written. */
export type TableLayout = "columns" | "stacked";

/** Marks a wrapper whose table is laid out as one card per row. */
export const TABLE_STACKED_CLASS = "stacked";

/**
 * Sub-pixel slack. Table widths land on fractional pixels, and a table that
 * misses its column by a quarter of a pixel is a table that fits.
 */
const FIT_TOLERANCE_PX = 1;

/**
 * The layout a table of `naturalInlineSize` takes in a column of
 * `availableInlineSize`. Both are CSS pixels.
 *
 * A width that is not a usable number -- zero, negative, NaN, a detached or
 * not-yet-laid-out element -- means "not measured yet", and an unmeasured table
 * keeps its columns. Guessing `stacked` from a zero measurement would stack
 * every table for one frame on the way in.
 */
export function tableLayoutFor(naturalInlineSize: number, availableInlineSize: number): TableLayout {
  if (!isMeasured(naturalInlineSize) || !isMeasured(availableInlineSize)) return "columns";
  return naturalInlineSize - availableInlineSize > FIT_TOLERANCE_PX ? "stacked" : "columns";
}

function isMeasured(inlineSize: number): boolean {
  return Number.isFinite(inlineSize) && inlineSize > 0;
}

/**
 * Lay out every table under `root` for the width it actually has.
 *
 * Each table is measured as columns before it is judged, so the measurement is
 * always the width the table wants rather than the width some earlier decision
 * left it at. The un-stack and the measurement happen in the same task, so the
 * reader never sees the intermediate state, and no width has to be remembered
 * between passes for the decision to be stable.
 *
 * The width available is the wrapper's own, not the column's. The style sheet
 * already sizes the wrapper to what the table asks for, clamped to the column
 * plus the bleed beside it, so a table that fits in the bleed measures as
 * fitting and stays a table. Reading the column instead would stack tables the
 * bleed can hold.
 */
export function fitTablesToColumn(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(".table-scroll").forEach((wrapper) => {
    const table = wrapper.querySelector("table");
    if (table === null) return;
    wrapper.classList.remove(TABLE_STACKED_CLASS);
    const layout = tableLayoutFor(table.scrollWidth, wrapper.clientWidth);
    if (layout === "stacked") wrapper.classList.add(TABLE_STACKED_CLASS);
    // A stacked table does not scroll, so it is not a scroll region and must not
    // hold a tab stop that goes nowhere.
    if (layout === "stacked") wrapper.removeAttribute("tabindex");
    else wrapper.setAttribute("tabindex", "0");
  });
}
