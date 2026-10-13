import { visibleMarks } from "./visibleMarks";
import "./MarkStrip.css";

/** One past outcome. Shape and colour both carry it, so the strip reads without colour. */
export type StripTone = "plain" | "bad" | "warn" | "live";

/**
 * Atom: a line of past outcomes, oldest on the left, one mark each: a dot for
 * one that went as planned, a square for a failure, a ring for one that never
 * happened, and a pulsing ring for one under way. Past `limit`, the oldest
 * marks become one count at the start that takes the worst tone it hides, so
 * the newest outcomes always show. Quiet, the plain marks fade with their row.
 */
export function MarkStrip({ marks, limit = 7, label, quiet = false }: {
  /** Oldest first. */
  marks: readonly StripTone[];
  limit?: number;
  /** The strip in words. Without it the strip is decoration and its row says what it means. */
  label?: string | undefined;
  quiet?: boolean;
}) {
  if (marks.length === 0) return null;
  // visibleMarks keeps the head of what it is given: give it the newest first.
  const { shown, more } = visibleMarks([...marks].reverse(), limit);
  return <span className="mark-strip" data-quiet={quiet || undefined} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {more ? <span className="mark-strip-more" data-tone={more.tone}>+{more.count}</span> : null}
    {[...shown].reverse().map((tone, index) => <span key={index} className="mark-strip-mark" data-tone={tone} />)}
  </span>;
}
