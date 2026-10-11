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
