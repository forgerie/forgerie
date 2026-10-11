import { describe, expect, it } from "vitest";
import { markRuns } from "./markRanges";

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
