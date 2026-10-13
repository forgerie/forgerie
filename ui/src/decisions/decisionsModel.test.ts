import { describe, expect, it } from "vitest";
import {
  age, deciderName, decisionSchema, decisionsOfRun, decisionsSchema, flaggedCount, logSummary, openerLabel, shortChoice, sortDecisions, type Decision,
} from "./decisionsModel";
import { ANSWER, GUESS, LOG_NOW, OVERTURNED, RUN_ID, SESSION_ANSWER, SESSION_DECISIONS } from "./fixtures/decisions";

const MIN = 60_000;

describe("the decision wire shape", () => {
  it("reads every kind, with and without a run, standing and overturned", () => {
    const kinds = ["child-answer", "guess", "gated", "auto-stop", "issue"] as const;
    for (const kind of kinds) expect(decisionSchema.parse({ ...ANSWER, kind }).kind).toBe(kind);
    expect(decisionSchema.parse(SESSION_ANSWER).runId).toBeUndefined();
    expect(decisionSchema.parse(OVERTURNED).state).toEqual({ kind: "overturned", note: "Put it in the header menu. The table foot is for paging.", at: LOG_NOW - 3 * MIN });
    expect(decisionsSchema.parse(SESSION_DECISIONS)).toEqual(SESSION_DECISIONS);
  });

  it("refuses a record it cannot show", () => {
    const noReason: Partial<Decision> = { ...ANSWER };
    delete noReason.reason;
    for (const bad of [
      { ...ANSWER, kind: "hunch" },
      { ...ANSWER, extra: true },
      { ...ANSWER, at: "yesterday" },
      { ...ANSWER, flagged: "yes" },
      noReason,
      { ...ANSWER, state: { kind: "overturned" } },
      { ...ANSWER, state: { kind: "withdrawn" } },
    ]) expect(decisionSchema.safeParse(bad).success).toBe(false);
  });
});

describe("ordering and counts", () => {
  const older: Decision = { ...ANSWER, id: "d-0", at: ANSWER.at };
  it("sorts newest first, ties by id descending as the server does, without changing its input", () => {
    const input = [OVERTURNED, ANSWER, SESSION_ANSWER, GUESS, older];
    const copy = [...input];
    expect(sortDecisions(input).map((decision) => decision.id)).toEqual(["d-1", "d-0", "d-2", "d-3", "d-4"]);
    expect(input).toEqual(copy);
  });

  it("counts flagged guesses that still stand; an overturned one is settled", () => {
    expect(flaggedCount(SESSION_DECISIONS)).toBe(1);
    expect(flaggedCount([GUESS, { ...GUESS, id: "d-9" }, OVERTURNED, ANSWER])).toBe(2);
    expect(flaggedCount([])).toBe(0);
  });

  it("lists a run's own decisions, newest first", () => {
    expect(decisionsOfRun([SESSION_ANSWER, OVERTURNED, ANSWER, GUESS], RUN_ID).map((decision) => decision.id)).toEqual(["d-1", "d-2", "d-3"]);
    expect(decisionsOfRun(SESSION_DECISIONS, "another-run")).toEqual([]);
  });
});

describe("words", () => {
  it("says how long ago in the picker's shorthand", () => {
    expect(age(LOG_NOW - 20_000, LOG_NOW)).toBe("<1m");
    expect(age(LOG_NOW - 12 * MIN, LOG_NOW)).toBe("12m");
    expect(age(LOG_NOW - 3 * 60 * MIN, LOG_NOW)).toBe("3h");
    expect(age(LOG_NOW - 2 * 24 * 60 * MIN, LOG_NOW)).toBe("2d");
    expect(age(LOG_NOW - 15 * 24 * 60 * MIN, LOG_NOW)).toBe("2w");
    // A clock that runs behind the server never shows a negative age.
    expect(age(LOG_NOW + 5 * MIN, LOG_NOW)).toBe("<1m");
  });

  it("calls the reader you, and any agent by its name", () => {
    expect(deciderName("user")).toBe("you");
    expect(deciderName("parent")).toBe("parent");
  });

  it("sums up the log and names the header button", () => {
    expect(logSummary(undefined)).toBeUndefined();
    expect(logSummary([])).toBe("None yet");
    expect(logSummary([ANSWER])).toBe("1 decision");
    expect(logSummary(SESSION_DECISIONS)).toBe("5 decisions, 1 flagged");
    expect(openerLabel(0)).toBe("Decisions");
    expect(openerLabel(1)).toBe("Decisions, 1 flagged guess to look at");
    expect(openerLabel(3)).toBe("Decisions, 3 flagged guesses to look at");
  });

  it("cuts a long choice to one short line", () => {
    expect(shortChoice("Keep it.\nSecond line")).toBe("Keep it.");
    expect(shortChoice("x".repeat(100))).toHaveLength(80);
    expect(shortChoice("x".repeat(100)).endsWith("…")).toBe(true);
  });
});
