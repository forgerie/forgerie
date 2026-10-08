import { isCodeRow, type CodeRow, type DiffRow } from "./unifiedDiff";

/**
 * One file's diff as editor text: one document line per code row, in diff
 * order. Removed lines sit between the lines around them, as in a unified
 * diff. Headers are not text; the editor draws the few that carry meaning.
 */
export interface DiffDocument {
  /** The code row behind each document line. */
  lines: readonly CodeRow[];
  text: string;
  /** Hunk headers that follow lines the diff left out, by the document line they come before. */
  gaps: ReadonlyMap<number, string>;
  /** Git's "\ No newline at end of file", by the document line it follows. */
  markers: ReadonlyMap<number, string>;
}

const HUNK_START = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

export function diffDocument(rows: readonly DiffRow[]): DiffDocument {
  const lines: CodeRow[] = [];
  const gaps = new Map<number, string>();
  const markers = new Map<number, string>();
  // The next old and new line numbers the diff has not shown yet.
  let nextOld = 1;
  let nextNew = 1;
  for (const row of rows) {
    if (isCodeRow(row)) {
      lines.push(row);
      if (row.kind !== "add") nextOld = row.oldLineNumber + 1;
      if (row.kind !== "remove") nextNew = row.newLineNumber + 1;
      continue;
    }
    if (row.kind === "marker" && lines.length > 0) markers.set(lines.length - 1, row.text);
    if (row.kind !== "hunk") continue;
    const start = HUNK_START.exec(row.text);
    // "-0,0" is an empty side: a new or deleted file starts at its first line.
    const old = Number(start?.[1] ?? 1) || 1;
    const next = Number(start?.[2] ?? 1) || 1;
    if (old > nextOld || next > nextNew) gaps.set(lines.length, row.text);
  }
  return { lines, text: lines.map((line) => line.text).join("\n"), gaps, markers };
}

/**
 * One side of the change as a file of its own, so a parser reads real code:
 * the old side has context and removed lines, the new side context and added
 * lines. `lines[i]` is the document line behind side line `i`.
 */
export interface DiffSide { text: string; lines: readonly number[] }
export function sideOf(document: DiffDocument, side: "old" | "new"): DiffSide {
  const skip = side === "old" ? "add" : "remove";
  const lines: number[] = [];
  const texts: string[] = [];
  document.lines.forEach((line, index) => {
    if (line.kind === skip) return;
    lines.push(index);
    texts.push(line.text);
  });
  return { text: texts.join("\n"), lines };
}

/** Unchanged lines shown on each side of a change, as git shows them. */
export const FOLD_CONTEXT = 3;
/** A fold that hides fewer lines than this costs as much room as the lines. */
export const FOLD_MINIMUM = 4;

/**
 * Runs of unchanged lines far from any change, as inclusive document line
 * ranges, for the editor to fold. Lines in `keep` (under a note, selected)
 * count as changes, so a fold never hides them. A run does not cross a gap.
 */
export function foldRanges(document: DiffDocument, keep: ReadonlySet<number> = new Set()): [number, number][] {
  const count = document.lines.length;
  const shown = new Uint8Array(count);
  document.lines.forEach((line, index) => {
    if (line.kind === "context" && !keep.has(index)) return;
    for (let near = Math.max(0, index - FOLD_CONTEXT); near <= Math.min(count - 1, index + FOLD_CONTEXT); near++) shown[near] = 1;
  });
  const ranges: [number, number][] = [];
  let start = -1;
  const close = (end: number) => {
    if (start >= 0 && end - start + 1 >= FOLD_MINIMUM) ranges.push([start, end]);
    start = -1;
  };
  for (let index = 0; index < count; index++) {
    if (document.gaps.has(index)) close(index - 1);
    if (shown[index]) close(index - 1);
    else if (start < 0) start = index;
  }
  close(count - 1);
  return ranges;
}

/** What a reader hears for a document line: "added line 12", "removed line 4", "line 9". */
export function lineWords(line: CodeRow): string {
  if (line.kind === "add") return `added line ${String(line.newLineNumber)}`;
  if (line.kind === "remove") return `removed line ${String(line.oldLineNumber)}`;
  return `line ${String(line.newLineNumber)}`;
}
