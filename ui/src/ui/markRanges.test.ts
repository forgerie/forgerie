import { describe, expect, it } from "vitest";
import { excerpt, MARK_LEAD, markRuns } from "./markRanges";

describe("mark runs", () => {
  it("splits text into plain and marked runs", () => {
    expect(markRuns("fix the deploy step", [[8, 14]])).toEqual([
      { text: "fix the ", marked: false }, { text: "deploy", marked: true }, { text: " step", marked: false },
    ]);
  });

  it("sorts, merges and clamps ranges, so no character is lost or repeated", () => {
    const runs = markRuns("abcdefgh", [[6, 20], [1, 3], [2, 4], [-5, 0]]);
    expect(runs).toEqual([
      { text: "a", marked: false }, { text: "bcd", marked: true }, { text: "ef", marked: false }, { text: "gh", marked: true },
    ]);
    expect(runs.map((run) => run.text).join("")).toBe("abcdefgh");
  });

  it("keeps text without ranges whole", () => {
    expect(markRuns("plain", [])).toEqual([{ text: "plain", marked: false }]);
    expect(markRuns("", [[0, 3]])).toEqual([{ text: "", marked: false }]);
  });
});

describe("a mark-aware excerpt", () => {
  // A 240-character passage whose only mark sits near its end.
  const text = `${"The service restarted cleanly and both units report active again after the merge. ".repeat(4).slice(0, 220)} then the deploy log`;
  const at = text.indexOf("deploy");

  it("starts shortly before a late first mark, after an ellipsis, so the mark is in the first clamped line", () => {
    expect(text.length).toBe(240);
    expect(at).toBeGreaterThan(220);
    const shown = excerpt(text, [[at, at + 6]]);
    expect(shown.text.startsWith("…")).toBe(true);
    const [[start, end]] = shown.ranges as [[number, number]];
    expect(shown.text.slice(start, end)).toBe("deploy");
    expect(Array.from(shown.text.slice(0, start)).length).toBeLessThanOrEqual(MARK_LEAD + 1);
    // It starts on a word, not in the middle of one.
    expect(shown.text.slice(1, 2)).toMatch(/\S/u);
    expect(text.endsWith(shown.text.slice(1))).toBe(true);
  });

  it("keeps a passage whose first mark is already near its start", () => {
    expect(excerpt("fix the deploy step", [[8, 14]])).toEqual({ text: "fix the deploy step", ranges: [[8, 14]] });
    expect(excerpt("no marks here at all, however long the passage is", [])).toEqual({ text: "no marks here at all, however long the passage is", ranges: [] });
  });

  it("never splits a character outside the basic plane", () => {
    const emoji = "😊".repeat(30);
    const shown = excerpt(`${emoji}deploy`, [[60, 66]]);
    expect(shown.text).toBe(`…${"😊".repeat(MARK_LEAD)}deploy`);
    expect(shown.text.slice(...shown.ranges[0]!)).toBe("deploy");
  });
});
