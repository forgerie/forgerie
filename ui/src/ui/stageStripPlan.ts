// How the stage strip draws a run as a block grid: rows, columns, and the leading stages that fold into a count.
import type { StageStripSegment, StageStripState } from "./StageStrip";

/** One cell of the grid: a lane's state, or `empty` above a stage with fewer lanes than the grid has rows. */
export type StripCell = StageStripState | "empty";

/**
 * The thresholds, in CSS px at a 16 px root. Each is a guess until it is
 * measured in the real strip. The mark and the gap are the tally's
 * (--tally-mark 0.4375rem, --tally-gap 0.1875rem, ui/src/ui/TallyRow.css).
 */
export const STRIP_MARK = 7;
export const STRIP_GAP = 3;
/** The grid may take at most this share of the strip's inner width. */
export const STRIP_GRID_SHARE = 0.4;
/** At most three blocks high, as the brand mark. */
export const STRIP_ROWS_MAX = 3;
/**
 * The room the `+n` count takes before the first shown column (1.25rem; StageStrip.css draws it that wide).
 * When not even one column fits beside it, every stage folds and the count stands alone, so the run stays
 * counted at any width. Below an inner width of STRIP_FOLD_WIDTH / STRIP_GRID_SHARE the count alone is over the share.
 */
export const STRIP_FOLD_WIDTH = 20;

/** Worst first: what a top block or the `+n` count shows when it stands for several lanes. */
const SEVERITY: readonly StageStripState[] = ["failed", "waiting", "working", "next", "done"];
/** The worst state among `states`; `done` when there are none. */
export function worstState(states: readonly StageStripState[]): StageStripState {
  return SEVERITY.find((state) => states.includes(state)) ?? "done";
}

export interface StripGrid {
  /** Blocks per column: min(STRIP_ROWS_MAX, the largest lane count). 0 without stages. */
  rows: number;
  /** How many leading stages fold into the `+n` count. Every stage folds when not one column fits. */
  fold: number;
  /** The worst state the count hides; undefined when nothing folds. */
  foldTone: StageStripState | undefined;
  /**
   * One column per shown stage, floor first: index 0 is the bottom block.
   * Each column has `rows` cells; a stage with fewer lanes is padded with
   * `empty` above. A stage with more lanes than rows shows its first rows−1
   * lanes, and its top block is the worst state of the lanes it hides.
   */
  columns: readonly (readonly StripCell[])[];
}

/** The width that `count` columns take, gaps between them included. */
export const columnsWidth = (count: number) => count <= 0 ? 0 : count * STRIP_MARK + (count - 1) * STRIP_GAP;

function column(lanes: readonly StageStripState[], rows: number): StripCell[] {
  const shown: StripCell[] = lanes.length > rows ? [...lanes.slice(0, rows - 1), worstState(lanes.slice(rows - 1))] : [...lanes];
  return [...shown, ...Array<StripCell>(rows - shown.length).fill("empty")];
}

/**
 * The grid for `segments` in a strip whose inner width is `innerWidth` CSS px.
 * While the width is unknown (0), every stage shows.
 */
export function stripGrid(segments: readonly StageStripSegment[], innerWidth: number): StripGrid {
  if (segments.length === 0) return { rows: 0, fold: 0, foldTone: undefined, columns: [] };
  const rows = Math.min(STRIP_ROWS_MAX, Math.max(1, ...segments.map((segment) => segment.lanes.length)));
  const budget = innerWidth * STRIP_GRID_SHARE;
  const fits = !(innerWidth > 0) || columnsWidth(segments.length) <= budget;
  const shown = fits ? segments.length
    : Math.max(0, Math.floor((budget - STRIP_FOLD_WIDTH) / (STRIP_MARK + STRIP_GAP)));
  const fold = segments.length - Math.min(shown, segments.length);
  const folded = segments.slice(0, fold);
  return {
    rows,
    fold,
    foldTone: fold === 0 ? undefined : worstState(folded.flatMap((segment) => segment.lanes)),
    columns: segments.slice(fold).map((segment) => column(segment.lanes, rows)),
  };
}
