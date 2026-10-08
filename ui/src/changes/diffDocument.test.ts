import { describe, expect, it } from "vitest";
import { diffDocument, foldRanges, lineWords, sideOf } from "./diffDocument";
import { parseUnifiedDiff } from "./unifiedDiff";

const document = (lines: string[]) => diffDocument(parseUnifiedDiff(lines.join("\n")).rows);
/** A full-context diff of a 20-line file with line 10 changed. */
const fullFile = () => document([
  "diff --git a/a.txt b/a.txt",
  "@@ -1,20 +1,20 @@",
  ...Array.from({ length: 9 }, (_, index) => ` ${String(index + 1)}`),
  "-10",
  "+ten",
  ...Array.from({ length: 10 }, (_, index) => ` ${String(index + 11)}`),
]);

describe("diffDocument", () => {
  it("makes one document line per code row and leaves headers out of the text", () => {
    const result = document(["diff --git a/x b/x", "@@ -1,2 +1,2 @@", " keep", "-old", "+new"]);
    expect(result.text).toBe("keep\nold\nnew");
    expect(result.lines.map((line) => line.kind)).toEqual(["context", "remove", "add"]);
  });

  it("shows a hunk header only where the diff left lines out", () => {
    const result = document(["@@ -1,1 +1,1 @@", "-a", "+b", "@@ -2,1 +2,1 @@", "-c", "+d", "@@ -40,1 +40,1 @@ function far() {", "-e", "+f"]);
    expect([...result.gaps]).toEqual([[4, "@@ -40,1 +40,1 @@ function far() {"]]);
  });

  it("marks a hunk that starts after line 1 as a gap, and a new file as none", () => {
    expect([...document(["@@ -18,1 +18,1 @@", "-a", "+b"]).gaps.keys()]).toEqual([0]);
    expect(document(["@@ -0,0 +1,1 @@", "+a"]).gaps.size).toBe(0);
  });

  it("keeps the no-newline marker with the line before it", () => {
    const result = document(["@@ -1 +1 @@", "-a", "\\ No newline at end of file", "+a"]);
    expect([...result.markers]).toEqual([[0, "\\ No newline at end of file"]]);
  });
});

describe("sideOf", () => {
  it("splits the document into the old file and the new file", () => {
    const result = document(["@@ -1,3 +1,3 @@", " a", "-b", "+B", " c"]);
    expect(sideOf(result, "old")).toEqual({ text: "a\nb\nc", lines: [0, 1, 3] });
    expect(sideOf(result, "new")).toEqual({ text: "a\nB\nc", lines: [0, 2, 3] });
  });
});

describe("foldRanges", () => {
  it("folds unchanged lines more than three lines from a change", () => {
    // Lines 0-8 are 1-9, 9 is removed, 10 added, 11-20 are 11-20.
    expect(foldRanges(fullFile())).toEqual([[0, 5], [14, 20]]);
  });

  it("does not fold a run shorter than the fold's own bar", () => {
    const result = document(["@@ -1,5 +1,5 @@", " 1", " 2", " 3", "-4", "+four", " 5"]);
    expect(foldRanges(result)).toEqual([]);
  });

  it("never hides a kept line, and shows context around it", () => {
    expect(foldRanges(fullFile(), new Set([18]))).toEqual([[0, 5]]);
    expect(foldRanges(fullFile(), new Set([2]))).toEqual([[14, 20]]);
  });

  it("does not fold across a gap", () => {
    const result = document([
      "@@ -1,6 +1,6 @@", "-a", "+A", " 2", " 3", " 4", " 5", " 6",
      "@@ -20,6 +20,6 @@", " 20", " 21", " 22", " 23", " 24", "-25", "+X",
    ]);
    expect(result.gaps.has(7)).toBe(true);
    // Before the gap only lines 5 and 6 are far from a change: two lines, too few to fold. After it, 20 and 21.
    expect(foldRanges(result)).toEqual([]);
  });
});

describe("lineWords", () => {
  it("names a line as a reader would", () => {
    const [context, removed, added] = document(["@@ -4,2 +4,2 @@", " a", "-b", "+B"]).lines;
    expect([context, removed, added].map((line) => line && lineWords(line))).toEqual(["line 4", "removed line 5", "added line 5"]);
  });
});
