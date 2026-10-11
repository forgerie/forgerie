/** A run of text, marked or not. */
export interface TextRun { text: string; marked: boolean }

/**
 * Splits text into plain and marked runs from `[start, end)` offsets. Ranges
 * are clamped to the text, sorted, and merged where they touch or overlap,
 * so a malformed range never drops or repeats a character.
 */
export function markRuns(text: string, ranges: readonly (readonly [number, number])[]): TextRun[] {
  const spans = ranges
    .map(([start, end]) => [Math.max(0, Math.min(start, text.length)), Math.max(0, Math.min(end, text.length))] as const)
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of spans) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  const runs: TextRun[] = [];
  let at = 0;
  for (const [start, end] of merged) {
    if (start > at) runs.push({ text: text.slice(at, start), marked: false });
    runs.push({ text: text.slice(start, end), marked: true });
    at = end;
  }
  if (at < text.length || runs.length === 0) runs.push({ text: text.slice(at), marked: false });
  return runs;
}

/** Code points of text a passage keeps before its first mark once it is cut short. */
export const MARK_LEAD = 16;
const ELLIPSIS = "…";

/**
 * A passage whose first mark always shows in its first clamped line: when
 * more than `lead` code points come before that mark, the text starts at a
 * word break shortly before it, after a "…". The ranges move with the text.
 */
export function excerpt(text: string, ranges: readonly (readonly [number, number])[], lead = MARK_LEAD): { text: string; ranges: [number, number][] } {
  const kept = ranges.map(([start, end]) => [start, end] as [number, number]);
  const firstStart = Math.min(...kept.filter(([start, end]) => end > start && start < text.length).map(([start]) => Math.max(0, start)));
  if (!Number.isFinite(firstStart)) return { text, ranges: kept };
  const before = Array.from(text.slice(0, firstStart));
  if (before.length <= lead) return { text, ranges: kept };
  // Cut on code points, so a pair is never split, then start at the next word.
  let cut = before.slice(0, before.length - lead).join("").length;
  const space = text.slice(cut, firstStart).search(/\s\S/u);
  if (space >= 0) cut += space + 1;
  const shift = cut - ELLIPSIS.length;
  return { text: `${ELLIPSIS}${text.slice(cut)}`, ranges: kept.map(([start, end]) => [start - shift, end - shift]) };
}
