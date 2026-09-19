/**
 * A table that does not fit the reading column stops being a table -- but only
 * when it really does not fit.
 *
 * Horizontal scrolling inside a transcript is the worst of both worlds: the
 * reader loses the first column as soon as they reach the last one, and on a
 * touch screen the gesture fights the transcript's own scroll. So a table too
 * wide for its column is laid out as one record per row instead, each cell
 * carrying its column heading.
 *
 * What decides "too wide" is the point. Asking whether the table fits at its
 * natural width asks whether every cell can hold its whole sentence on one
 * line, and a cell holding a sentence never can. That measurement stacked every
 * two-column table of prose, including the ones that would have fitted
 * comfortably once the cells were allowed to wrap -- the reader lost the table
 * to save a line break.
 *
 * So each column is charged what it needs rather than what it wants: a short
 * column costs its natural width, and a column of prose may wrap down to
 * COLUMN_WRAP_TARGET_PX. If the sum fits, the table stays a table and wraps.
 *
 * The decision is a pure function of measured widths, so it is the same on
 * every device and needs no breakpoints. Nothing here asks what kind of device
 * is showing it.
 */

/** How a table is laid out. `columns` is the table as written. */
export type TableLayout = "columns" | "stacked";

/** Marks a wrapper whose table is laid out as records instead of columns. */
export const TABLE_STACKED_CLASS = "stacked";

/**
 * Marks a wrapper being measured: the table is released to its natural width
 * and the wrapper to the full width it is allowed, so one is read against the
 * other. Applied and removed inside one task, so it is never painted.
 */
export const TABLE_MEASURING_CLASS = "measuring";

/**
 * How narrow a column of prose may be wrapped before the table gives up being a
 * table. 224px is about 28 characters at the table's type size: narrow, but
 * still a line rather than a stack of single words.
 */
export const COLUMN_WRAP_TARGET_PX = 224;

/**
 * The narrowest a stacked record's field may be asked to stand beside another.
 * 152px holds a date, a version, a name -- the values that are worth pairing up
 * -- without pairing up two half-sentences.
 */
export const FIELD_MIN_FLOOR_PX = 152;

/** The custom property the style sheet reads for the record grid's track floor. */
export const FIELD_MIN_PROPERTY = "--record-field-min";

/**
 * Sub-pixel slack. Table widths land on fractional pixels, and a table that
 * misses its column by a quarter of a pixel is a table that fits.
 */
const FIT_TOLERANCE_PX = 1;

/**
 * The layout a table whose columns want `columnInlineSizes` takes in a space of
 * `availableInlineSize`. All values are CSS pixels.
 *
 * A width that is not a usable number -- zero, negative, NaN, a detached or
 * not-yet-laid-out element -- means "not measured yet", and an unmeasured table
 * keeps its columns. Guessing `stacked` from a zero measurement would stack
 * every table for one frame on the way in.
 */
export function tableLayoutFor(columnInlineSizes: readonly number[], availableInlineSize: number): TableLayout {
  if (!isMeasured(availableInlineSize)) return "columns";
  if (!columnInlineSizes.some(isMeasured)) return "columns";
  const required = columnInlineSizes.reduce((total, columnInlineSize) => total + Math.min(columnInlineSize, COLUMN_WRAP_TARGET_PX), 0);
  return required - availableInlineSize > FIT_TOLERANCE_PX ? "stacked" : "columns";
}

function isMeasured(inlineSize: number): boolean {
  return Number.isFinite(inlineSize) && inlineSize > 0;
}

/**
 * How wide a field has to be before a record will stand two of them side by
 * side, given what the value columns asked for.
 *
 * The style sheet cannot see what a cell holds, so it is told. A table of dates
 * and names gets a low floor and pairs its fields up; a table of sentences gets
 * the wrap target and takes a row per field. Without this the same floor served
 * both, and either six short values became twelve lines or two sentences were
 * squeezed into half a column each.
 */
export function recordFieldMinInlineSize(columnInlineSizes: readonly number[]): number {
  const valueInlineSizes = columnInlineSizes.slice(1).filter(isMeasured);
  if (valueInlineSizes.length === 0) return FIELD_MIN_FLOOR_PX;
  return Math.min(COLUMN_WRAP_TARGET_PX, Math.max(FIELD_MIN_FLOOR_PX, ...valueInlineSizes));
}

/**
 * Lay out every table under `root` for the space it actually has.
 *
 * Each table is measured released -- un-stacked, at its natural width, in a
 * wrapper at its full allowance -- so the measurement is always what the table
 * wants and what it may have, rather than what some earlier decision left it
 * at. The release, the measurement, and the decision happen in one task, so the
 * reader never sees the intermediate state and no width has to be remembered
 * between passes for the decision to be stable.
 */
export function fitTablesToColumn(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(".table-scroll").forEach((wrapper) => {
    const table = wrapper.querySelector("table");
    if (table === null) return;
    wrapper.classList.remove(TABLE_STACKED_CLASS);
    wrapper.classList.add(TABLE_MEASURING_CLASS);
    const availableInlineSize = wrapper.clientWidth;
    const columnInlineSizes = naturalColumnInlineSizes(table);
    wrapper.classList.remove(TABLE_MEASURING_CLASS);

    const layout = tableLayoutFor(columnInlineSizes, availableInlineSize);
    if (layout === "stacked") {
      wrapper.classList.add(TABLE_STACKED_CLASS);
      wrapper.style.setProperty(FIELD_MIN_PROPERTY, `${String(recordFieldMinInlineSize(columnInlineSizes))}px`);
      // A stacked table does not scroll, so it is not a scroll region and must
      // not hold a tab stop that goes nowhere.
      wrapper.removeAttribute("tabindex");
      return;
    }
    wrapper.style.removeProperty(FIELD_MIN_PROPERTY);
    wrapper.setAttribute("tabindex", "0");
  });
}

/**
 * What each column asks for, read from one row.
 *
 * Under the measuring state the table lays out at max-content, so every cell in
 * a row has resolved to its own column's width: one row therefore reports the
 * whole table. The heading row is the one to read, because it is the row every
 * table has under this renderer; a table written without one falls back to its
 * first body row.
 */
function naturalColumnInlineSizes(table: HTMLTableElement): number[] {
  const headings = table.querySelectorAll<HTMLElement>("thead th");
  const cells = headings.length > 0 ? headings : table.querySelectorAll<HTMLElement>("tbody tr:first-child > *");
  return [...cells].map((cell) => cell.getBoundingClientRect().width);
}
