/**
 * One file's unified diff as rows. Code rows carry their positions; every
 * other row (file headers, hunk headers, "\ No newline" markers) is shown but
 * never becomes part of a note.
 */
export type DiffRow =
  | { kind: "context"; text: string; oldLineNumber: number; newLineNumber: number }
  | { kind: "add"; text: string; newLineNumber: number }
  | { kind: "remove"; text: string; oldLineNumber: number }
  | { kind: "hunk"; text: string }
  | { kind: "meta"; text: string }
  | { kind: "marker"; text: string };
export type CodeRow = Extract<DiffRow, { kind: "context" | "add" | "remove" }>;

export interface ParsedDiff {
  rows: DiffRow[];
  /** Git said the file is binary, so there is no code to show. */
  binary: boolean;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

export const isCodeRow = (row: DiffRow): row is CodeRow => row.kind === "context" || row.kind === "add" || row.kind === "remove";

/**
 * The hunk header's counts decide where a hunk ends, so a removed line that
 * reads "--- a/x" is still code, and the next file's header is not.
 */
export function parseUnifiedDiff(diff: string): ParsedDiff {
  const lines = diff.split("\n");
  // A diff ends with a newline, which leaves one empty string that is not a row.
  if (lines.at(-1) === "") lines.pop();
  const rows: DiffRow[] = [];
  let binary = false;
  let oldLine = 0;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of lines.map((line) => line.replace(/\r$/u, ""))) {
    const inHunk = oldLeft > 0 || newLeft > 0;
    if (inHunk) {
      const mark = raw[0];
      if (mark === "+" && newLeft > 0) { rows.push({ kind: "add", text: raw.slice(1), newLineNumber: newLine++ }); newLeft--; continue; }
      if (mark === "-" && oldLeft > 0) { rows.push({ kind: "remove", text: raw.slice(1), oldLineNumber: oldLine++ }); oldLeft--; continue; }
      // Some tools trim the space from an empty context line.
      if ((mark === " " || raw === "") && oldLeft > 0 && newLeft > 0) {
        rows.push({ kind: "context", text: raw.slice(1), oldLineNumber: oldLine++, newLineNumber: newLine++ });
        oldLeft--; newLeft--;
        continue;
      }
    }
    if (raw.startsWith("\\")) { rows.push({ kind: "marker", text: raw }); continue; }
    const hunk = HUNK.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newLine = Number(hunk[3]);
      newLeft = hunk[4] === undefined ? 1 : Number(hunk[4]);
      rows.push({ kind: "hunk", text: raw });
      continue;
    }
    // A malformed hunk ends at the first row that does not fit it.
    oldLeft = 0;
    newLeft = 0;
    if (/^Binary files .* differ$/u.test(raw) || raw === "GIT binary patch") binary = true;
    rows.push({ kind: "meta", text: raw });
  }
  return { rows, binary };
}
