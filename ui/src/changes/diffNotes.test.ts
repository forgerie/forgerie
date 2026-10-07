import { describe, expect, it } from "vitest";
import { annotationsOf, carriesNotes, commentProblem, diffNoteSchema, linesOf, NOTE_LIMITS, noteRange, placeNotes, selectionProblem, tapRow, trayProblem, type DiffNote } from "./diffNotes";
import { parseUnifiedDiff } from "./unifiedDiff";

const { rows } = parseUnifiedDiff([
  "--- a/src/retry.ts", "+++ b/src/retry.ts",
  "@@ -7,3 +7,3 @@", " keep", "-const retries = 3;", "+const retries = 0;", " tail",
  "@@ -40,1 +40,2 @@", " a", "+b", "",
].join("\n"));
// rows: 0 meta, 1 meta, 2 hunk, 3 context, 4 remove, 5 add, 6 context, 7 hunk, 8 context, 9 add
const note = (overrides: Partial<DiffNote> = {}): DiffNote => ({ id: "n1", path: "src/retry.ts", staged: false, comment: "Keep the retry limit.",
  lines: linesOf(rows, { anchor: 4, focus: 5 }), ...overrides });

describe("selecting rows", () => {
  it("starts on a tap, stretches to the next tap, and clears a one-row selection tapped again", () => {
    const one = tapRow(undefined, 4);
    expect(one).toEqual({ anchor: 4, focus: 4 });
    expect(tapRow(one, 4)).toBeUndefined();
    const range = tapRow(one, 9);
    expect(range).toEqual({ anchor: 4, focus: 9 });
    // A range keeps its first row; tapping above it stretches the other way.
    expect(tapRow(range, 3)).toEqual({ anchor: 4, focus: 3 });
  });

  it("turns rows into contract lines: prefixes stripped, only that kind's positions, headers between hunks skipped", () => {
    expect(linesOf(rows, { anchor: 9, focus: 4 })).toEqual([
      { kind: "remove", oldLineNumber: 8, text: "const retries = 3;" },
      { kind: "add", newLineNumber: 8, text: "const retries = 0;" },
      { kind: "context", oldLineNumber: 9, newLineNumber: 9, text: "tail" },
      { kind: "context", oldLineNumber: 40, newLineNumber: 40, text: "a" },
      { kind: "add", newLineNumber: 41, text: "b" },
    ]);
    expect(linesOf(rows, { anchor: 7, focus: 7 })).toEqual([]);
  });

  it("names the range by new lines, or by old lines when only removals are selected", () => {
    expect(noteRange(linesOf(rows, { anchor: 4, focus: 6 }))).toBe("8–9");
    expect(noteRange(linesOf(rows, { anchor: 4, focus: 4 }))).toBe("old 8");
    expect(noteRange(linesOf(rows, { anchor: 9, focus: 9 }))).toBe("41");
  });
});

describe("note bounds", () => {
  it("refuses header-only selections, too many lines, unsafe paths, and blank comments", () => {
    expect(selectionProblem("src/retry.ts", [])).toMatch(/code line/u);
    const many = Array.from({ length: NOTE_LIMITS.linesPerNote + 1 }, (_, index) => ({ kind: "add" as const, newLineNumber: index + 1, text: "x" }));
    expect(selectionProblem("src/retry.ts", many)).toMatch(/at most 200 lines/u);
    for (const path of ["../secret", "/etc/passwd", "C:/x", "a\\b", "a/./b", "dir/"]) {
      expect(selectionProblem(path, note().lines), path).toMatch(/path/u);
    }
    expect(selectionProblem("src/retry.ts", [{ kind: "add", newLineNumber: 1, text: "x".repeat(NOTE_LIMITS.lineChars + 1) }])).toMatch(/longer/u);
    expect(selectionProblem("src/retry.ts", note().lines)).toBeUndefined();
    expect(commentProblem("  \n")).toMatch(/Write/u);
    expect(commentProblem("x".repeat(NOTE_LIMITS.commentChars + 1))).toMatch(/under/u);
    expect(commentProblem("Fix it")).toBeUndefined();
  });

  it("caps the tray at 16 notes and the server's combined size, counting an edit once", () => {
    const sixteen = Array.from({ length: 16 }, (_, index) => note({ id: `n${index}` }));
    expect(trayProblem(sixteen, note())).toMatch(/at most 16/u);
    expect(trayProblem(sixteen, note(), "n3")).toBeUndefined();
    const big = note({ comment: "x".repeat(4000), lines: Array.from({ length: 16 }, (_, index) => ({ kind: "add" as const, newLineNumber: index + 1, text: "y".repeat(4000) })) });
    expect(trayProblem([], big)).toMatch(/too long/u);
  });

  it("sends the wire shape without browser ids, and nothing for an empty tray", () => {
    expect(annotationsOf([])).toBeUndefined();
    expect(annotationsOf([note()])).toEqual([{ path: "src/retry.ts", staged: false, comment: "Keep the retry limit.", lines: note().lines }]);
    expect(diffNoteSchema.safeParse(note()).success).toBe(true);
    expect(diffNoteSchema.safeParse({ ...note(), lines: [{ kind: "add", newLineNumber: 1, oldLineNumber: 1, text: "x" }] }).success).toBe(false);
  });

  it("lets only chat messages carry notes", () => {
    expect(carriesNotes("fix these")).toBe(true);
    expect(carriesNotes("")).toBe(true);
    expect(carriesNotes("!ls")).toBe(false);
    expect(carriesNotes("/compact")).toBe(false);
  });
});

describe("placing notes in a diff", () => {
  it("draws a note under its last line, covers its rows, and lists notes whose code moved", () => {
    const placed = note();
    const gone = note({ id: "n2", lines: [{ kind: "add", newLineNumber: 99, text: "gone" }] });
    const result = placeNotes(rows, [placed, gone]);
    expect([...result.ends.entries()]).toEqual([[5, [placed]]]);
    expect([...result.covered]).toEqual([4, 5]);
    expect(result.moved).toEqual([gone]);
  });
});
