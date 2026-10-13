// Which marks of a tally show, and the count that stands for the rest. Shared by the tallies and strips that draw marks.
/** One mark's state. `faint` is a mark for work that never finished. */
export type TallyTone = "plain" | "bad" | "warn" | "live" | "faint";

/** The worst tone wins when marks are summed into one count. */
const SEVERITY: readonly TallyTone[] = ["plain", "faint", "live", "warn", "bad"];
const worst = (tones: readonly TallyTone[]): TallyTone =>
  tones.reduce<TallyTone>((top, tone) => SEVERITY.indexOf(tone) > SEVERITY.indexOf(top) ? tone : top, "plain");

/**
 * The marks a row shows. Past `limit`, the tail becomes one count that takes
 * the worst tone it hides, so a failure in the tail stays visible.
 */
export function visibleMarks(marks: readonly TallyTone[], limit: number): { shown: readonly TallyTone[]; more?: { count: number; tone: TallyTone } } {
  if (marks.length <= limit) return { shown: marks };
  const shown = marks.slice(0, Math.max(limit - 1, 0));
  const hidden = marks.slice(shown.length);
  return { shown, more: { count: hidden.length, tone: worst(hidden) } };
}
