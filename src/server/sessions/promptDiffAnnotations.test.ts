import { describe, expect, it } from "vitest";
import { composeDiffAnnotationPrompt } from "./promptDiffAnnotations.js";

const note = {
  path: "src/retry.ts",
  staged: false,
  comment: "Keep the retry limit.",
  lines: [
    { kind: "remove", oldLineNumber: 8, text: "const retries = 3;" },
    { kind: "add", newLineNumber: 8, text: "const retries = 0;" },
  ],
};

describe("structured diff annotation prompts", () => {
  it("preserves ordinary prompts byte for byte", () => {
    expect(composeDiffAnnotationPrompt("  Keep this\n", undefined)).toBe("  Keep this\n");
    expect(composeDiffAnnotationPrompt("  Keep this\n", [])).toBe("  Keep this\n");
    expect(composeDiffAnnotationPrompt(undefined, undefined)).toBeUndefined();
  });

  it("quotes captured old and new lines with the path, staged state, and comment", () => {
    expect(composeDiffAnnotationPrompt("Please fix this.", [note])).toBe([
      "Please fix this.",
      "",
      "Review notes below quote captured diff lines, not the current working tree.",
      "",
      'Review note on "src/retry.ts" (unstaged diff; old line 8; new line 8):',
      "Old/new positions by excerpt row: 8/-, -/8.",
      "```diff",
      "-const retries = 3;",
      "+const retries = 0;",
      "```",
      "",
      "Keep the retry limit.",
    ].join("\n"));
  });

  it("supports annotation-only prompts, ranges, deleted files, and Unicode paths", () => {
    const text = composeDiffAnnotationPrompt(undefined, [{
      path: "old/重试.ts",
      staged: true,
      comment: "Restore this file.",
      lines: [{ kind: "remove", oldLineNumber: 2, text: "first" }, { kind: "remove", oldLineNumber: 3, text: "second" }],
    }]);
    expect(text).toContain('"old/重试.ts" (staged diff; old lines 2-3; no new lines)');
    expect(text).toContain("-first\n-second");
    expect(text).toContain("Restore this file.");
  });

  it("retains exact context positions when the selection crosses hunks", () => {
    const text = composeDiffAnnotationPrompt("", [{ ...note, lines: [
      { kind: "context", oldLineNumber: 2, newLineNumber: 3, text: "first" },
      { kind: "context", oldLineNumber: 20, newLineNumber: 21, text: "second" },
    ] }]);
    expect(text).toContain("old lines 2-20; new lines 3-21");
    expect(text).toContain("Old/new positions by excerpt row: 2/3, 20/21.");
  });

  it("uses a fence longer than backticks in the selected code and quotes unusual paths", () => {
    const text = composeDiffAnnotationPrompt("", [{ ...note, path: "src/a`b.ts", lines: [{ kind: "add", newLineNumber: 1, text: "````diff" }] }]);
    expect(text).toContain('"src/a`b.ts"');
    expect(text).toContain("`````diff\n+````diff\n`````");
  });

  it.each([
    null, {}, [null], [{ ...note, staged: "false" }], [{ ...note, comment: " \n " }],
    [{ ...note, path: "../secret" }], [{ ...note, path: "/secret" }], [{ ...note, path: "C:/secret" }],
    [{ ...note, path: "src/../secret" }], [{ ...note, path: "src\\secret" }], [{ ...note, path: "src/./a" }],
    [{ ...note, path: "src/\nsecret" }], [{ ...note, path: "src/secret\n" }],
    [{ ...note, path: "src//a" }], [{ ...note, extra: true }],
    [{ ...note, lines: [] }], [{ ...note, lines: [{ kind: "add", oldLineNumber: 1, newLineNumber: 1, text: "x" }] }],
    [{ ...note, lines: [{ kind: "context", newLineNumber: 1, text: "x" }] }],
    [{ ...note, lines: [{ kind: "add", newLineNumber: 0, text: "x" }] }],
    [{ ...note, lines: [{ kind: "add", newLineNumber: 1.5, text: "x" }] }],
    [{ ...note, lines: [{ kind: "add", newLineNumber: 1, text: "two\nlines" }] }],
    [{ ...note, lines: [{ kind: "add", newLineNumber: 1, text: "line\n" }] }],
    [{ ...note, lines: [{ kind: "add", newLineNumber: 1, text: "line\r" }] }],
    [{ ...note, lines: [{ kind: "add", newLineNumber: 1, text: "nul\0byte" }] }],
  ])("rejects malformed annotations: %j", (annotations) => {
    expect(() => composeDiffAnnotationPrompt("Fix", annotations)).toThrow(/diffAnnotations/);
  });

  it("rejects descending or duplicate positions", () => {
    for (const number of [1, 2]) {
      expect(() => composeDiffAnnotationPrompt("Fix", [{ ...note, lines: [
        { kind: "context", oldLineNumber: 2, newLineNumber: 2, text: "x" },
        { kind: "context", oldLineNumber: number, newLineNumber: number, text: "y" },
      ] }])).toThrow(/diffAnnotations/);
    }
  });

  it("bounds annotation count, line count, strings, and aggregate content", () => {
    for (const annotations of [
      Array.from({ length: 17 }, () => note),
      [{ ...note, comment: "x".repeat(4097) }],
      [{ ...note, path: "x".repeat(1025) }],
      [{ ...note, lines: [{ kind: "add", newLineNumber: 1, text: "x".repeat(4097) }] }],
      [{ ...note, lines: Array.from({ length: 201 }, (_, index) => ({ kind: "add", newLineNumber: index + 1, text: "x" })) }],
      [{ ...note, lines: Array.from({ length: 17 }, (_, index) => ({ kind: "add", newLineNumber: index + 1, text: "x".repeat(4096) })) }],
    ]) {
      expect(() => composeDiffAnnotationPrompt("Fix", annotations)).toThrow(/diffAnnotations/);
    }
  });

  it("rejects non-string prompt text when annotations are present", () => {
    expect(() => composeDiffAnnotationPrompt(42, [note])).toThrow(/Prompt text/);
    expect(() => composeDiffAnnotationPrompt(null, [note])).toThrow(/Prompt text/);
  });
});
