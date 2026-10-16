import { describe, expect, it } from "vitest";
import { applyFilter, dayLabel, filterCounts, foldRepeats, gatedWord, logSections } from "./decisionGroups";
import type { Decision } from "./decisionsModel";
import { ANSWER, GUESS, LOG_NOW, OVERTURNED, SESSION_ANSWER } from "./fixtures/decisions";

const HOUR = 3_600_000;
const gate = (id: string, at: number, question = "Push Git refs with unknown default branch"): Decision => ({
  id, at, kind: "gated", by: "user", question, choice: "approved", reason: "The user approved this tool call", flagged: false, state: { kind: "standing" } });

describe("the decision log's sections", () => {
  it("puts standing flagged guesses first, and keeps an overturned guess with the rest", () => {
    const { flagged, days } = logSections([ANSWER, GUESS, OVERTURNED], LOG_NOW);
    expect(flagged.map((decision) => decision.id)).toEqual([GUESS.id]);
    expect(days.flatMap((day) => day.groups.flatMap((group) => group.decisions.map((decision) => decision.id)))).toEqual([ANSWER.id, OVERTURNED.id]);
  });

  it("groups the rest by local day, newest first", () => {
    const { days } = logSections([SESSION_ANSWER, ANSWER], LOG_NOW);
    expect(days.map((day) => day.label)).toEqual(["Today", "Yesterday"]);
  });

  it("folds neighbouring decisions that read the same, and nothing else", () => {
    const groups = foldRepeats([gate("a", LOG_NOW - HOUR), gate("b", LOG_NOW - 2 * HOUR), gate("c", LOG_NOW - 3 * HOUR, "Merge pull request #59"), gate("d", LOG_NOW - 4 * HOUR)]);
    expect(groups.map((group) => group.decisions.map((decision) => decision.id))).toEqual([["a", "b"], ["c"], ["d"]]);
  });

  it("never folds an overturned decision into a standing one", () => {
    const overturned: Decision = { ...gate("b", LOG_NOW - 2 * HOUR), state: { kind: "overturned", note: "No.", at: LOG_NOW } };
    expect(foldRepeats([gate("a", LOG_NOW - HOUR), overturned])).toHaveLength(2);
  });
});

describe("the decision log's filters", () => {
  it("counts all, the standing flagged guesses, and each kind present", () => {
    expect(filterCounts([ANSWER, GUESS, OVERTURNED, gate("g", LOG_NOW)])).toEqual([
      { filter: "all", count: 4 }, { filter: "flagged", count: 1 }, { filter: "child-answer", count: 1 }, { filter: "guess", count: 2 }, { filter: "gated", count: 1 }]);
  });
  it("narrows to one kind or to the flagged guesses", () => {
    expect(applyFilter([ANSWER, GUESS, OVERTURNED], "guess").map((decision) => decision.id)).toEqual([GUESS.id, OVERTURNED.id]);
    expect(applyFilter([ANSWER, GUESS, OVERTURNED], "flagged").map((decision) => decision.id)).toEqual([GUESS.id]);
  });
});

describe("decision words", () => {
  it("names today and yesterday, and dates the rest", () => {
    expect(dayLabel(LOG_NOW, LOG_NOW)).toBe("Today");
    const yesterday = new Date(LOG_NOW); yesterday.setDate(yesterday.getDate() - 1);
    expect(dayLabel(yesterday.getTime(), LOG_NOW)).toBe("Yesterday");
    expect(dayLabel(LOG_NOW - 5 * 24 * HOUR, LOG_NOW)).not.toMatch(/Today|Yesterday/u);
  });
  it("reads a gated choice as one word", () => {
    expect(gatedWord("approved")).toBe("Approved");
    expect(gatedWord("denied")).toBe("Denied");
  });
});
