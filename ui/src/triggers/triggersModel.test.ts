import { describe, expect, it } from "vitest";
import type { Trigger, TriggerFire } from "@shared/triggers";
import {
  attentionTone, groupTriggers, HEADER_TIGHT, matchesFilter, problemsSince, readTriggersPlace, ROW_NARROW, ROW_WIDE, SHORT_BODY, totalWords, triggerEntry,
  triggersPlan, writeTriggersPlace,
} from "./triggersModel";
import { audit, docs, manyList, mixedList, nightly, notes, triage } from "./fixtures/triggers";

const params = (query: string) => new URLSearchParams(query);

describe("the triggers' places in the URL", () => {
  it("reads the list, the create page, and one trigger, and nothing without the parameter", () => {
    expect(readTriggersPlace(params(""))).toBeUndefined();
    expect(readTriggersPlace(params("?triggers"))).toEqual({ view: "list" });
    expect(readTriggersPlace(params("?triggers="))).toEqual({ view: "list" });
    expect(readTriggersPlace(params("?triggers&create"))).toEqual({ view: "create" });
    expect(readTriggersPlace(params("?triggers=nightly-refinement"))).toEqual({ view: "trigger", id: "nightly-refinement" });
  });
  it("keeps `new` as a trigger ID, not the new-session dialog", () => {
    expect(readTriggersPlace(params("?triggers=new"))).toEqual({ view: "trigger", id: "new" });
  });
  it("writes each place so it reads back the same", () => {
    for (const place of [{ view: "list" }, { view: "create" }, { view: "trigger", id: "weekday-triage" }] as const) {
      const url = new URL("https://forgerie.test/?session=abc&create");
      writeTriggersPlace(url, place);
      expect(readTriggersPlace(url.searchParams)).toEqual(place);
      expect(url.searchParams.get("session")).toBe("abc");
    }
  });
});

describe("the session list's entry", () => {
  it("shows no chip when nothing needs a look, or before the first read", () => {
    expect(triggerEntry({ type: "loading" })).toEqual({ title: "Triggers", attention: false });
    expect(triggerEntry({ type: "ready", value: { ...mixedList, triggers: [triage], attentionCount: 0 } })).toEqual({ title: "Triggers", attention: false });
  });
  it("counts in the bad tone when the latest problem of one trigger failed", () => {
    expect(triggerEntry({ type: "ready", value: mixedList })).toEqual({ chip: { text: "3", tone: "bad" }, title: "Triggers: 3 need a look", attention: true });
  });
  it("counts in the warn tone when every problem was missed", () => {
    expect(triggerEntry({ type: "ready", value: { ...mixedList, triggers: [audit, triage], attentionCount: 1 } }))
      .toEqual({ chip: { text: "1", tone: "warn" }, title: "Triggers: 1 needs a look", attention: true });
  });
  it("says Off when the store is unavailable", () => {
    expect(triggerEntry({ type: "off", message: "database is locked" })).toEqual({ chip: { text: "Off", tone: "bad" }, title: "Triggers are off", attention: true });
  });
  it("keeps the last count after a failed read", () => {
    expect(triggerEntry({ type: "failed", message: "HTTP 500", last: mixedList }).chip).toEqual({ text: "3", tone: "bad" });
  });
});

describe("problems since attention", () => {
  it.each(["failed", "missed"] as const)("filters %s projects by their own timestamp, with recordedAt for old history", (kind) => {
    const at = 2_000;
    const fire = (id: string, recordedAt: number, problemAt?: number): TriggerFire => ({
      occurrence: 1_000, requestId: id, cause: "schedule", recordedAt, skippedBefore: 0,
      outcome: { kind: "running", startedAt: 1_000 },
      projects: [{ cwd: "/a", outcome: kind === "failed" ? { kind, error: id, failedAt: problemAt } : { kind, missedAt: problemAt } }],
    });
    const trigger: Trigger = { ...nightly, attention: { since: at }, history: [
      fire("acknowledged", 3_000, at - 1), fire("old-acknowledged", at - 1),
      fire("boundary", 1_000, at), fire("newest", 1_000, at + 1), fire("old-boundary", at),
    ] };
    expect(problemsSince(trigger).map((item) => item.requestId)).toEqual(["newest", "boundary", "old-boundary"]);
    expect(attentionTone(trigger)).toBe(kind === "failed" ? "bad" : "warn");
  });

  it("does not revive an acknowledged running fire when an older overlapping fire fails", () => {
    const running = (id: string, admitted: number, failedAt: number): TriggerFire => ({
      occurrence: admitted, requestId: id, cause: "schedule", recordedAt: admitted, skippedBefore: 0,
      outcome: { kind: "running", startedAt: admitted }, projects: [
        { cwd: "/a", outcome: { kind: "failed", error: id, failedAt } },
        { cwd: "/b", outcome: { kind: "running", startedAt: admitted } },
      ],
    });
    // B starts, then A. A fails and is seen; B fails later while A's sibling still runs.
    const a = running("A", 2_000, 3_000);
    const b = running("B", 1_000, 5_000);
    const trigger: Trigger = { ...nightly, attention: { since: 5_000 }, history: [a, b] };
    expect(problemsSince(trigger).map((fire) => fire.requestId)).toEqual(["B"]);
    expect(problemsSince({ ...trigger, attention: { since: 3_000 } }).map((fire) => fire.requestId)).toEqual(["B", "A"]);
    expect(problemsSince({ ...trigger, attention: null })).toEqual([]);
    expect(attentionTone({ ...trigger, attention: null })).toBeUndefined();
  });
  it("counts a running fire with a failed project, though it was recorded before attention was set", () => {
    const running: Trigger = { ...nightly, attention: { since: 2_000 }, history: [{ occurrence: 1_000, requestId: "r", cause: "schedule", recordedAt: 1_000, skippedBefore: 0,
      outcome: { kind: "running", startedAt: 1_000 }, projects: [{ cwd: "/a", outcome: { kind: "failed", error: "x", failedAt: 2_000 } }, { cwd: "/b", outcome: { kind: "running", startedAt: 1_000 } }] }] };
    expect(problemsSince(running).map((fire) => fire.requestId)).toEqual(["r"]);
    expect(attentionTone(running)).toBe("bad");
    // Still running everywhere: nothing has failed yet.
    const quiet: Trigger = { ...running, history: running.history.map((fire) => ({ ...fire, projects: [{ cwd: "/b", outcome: { kind: "running", startedAt: 1_000 } }] })) };
    expect(problemsSince(quiet)).toEqual([]);
  });
});

describe("groups and order", () => {
  it("puts problems first, newest first, then active by next run, then paused by name", () => {
    const groups = groupTriggers(mixedList.triggers);
    expect(groups.map((group) => [group.label, group.triggers.map((trigger) => trigger.id)])).toEqual([
      ["Needs a look", ["nightly-docs-sweep", "dependency-audit", "nightly-refinement"]],
      ["Active", ["inbox-digest", "weekday-triage", "release-notes", "weekly-release-notes"]],
      ["Paused", ["docs-sweep"]],
    ]);
  });
  it("draws no empty group, and a paused trigger that needs a look stays in Needs a look", () => {
    const pausedProblem: Trigger = { ...docs, attention: { since: 1 } };
    expect(groupTriggers([pausedProblem, notes]).map((group) => group.key)).toEqual(["attention", "active"]);
    expect(groupTriggers([])).toEqual([]);
  });
  it("tones a trigger by its newest problem", () => {
    expect(attentionTone(nightly)).toBe("bad");
    expect(attentionTone(audit)).toBe("warn");
    expect(attentionTone(triage)).toBeUndefined();
  });
});

describe("the filter", () => {
  it("matches the name, the project's words, and the workflow, ignoring case", () => {
    expect(matchesFilter(nightly, "NIGHTLY", "forgerie")).toBe(true);
    expect(matchesFilter(nightly, "forg", "forgerie")).toBe(true);
    expect(matchesFilter(nightly, "refine-back", "forgerie")).toBe(true);
    expect(matchesFilter(nightly, "docs", "forgerie")).toBe(false);
    expect(matchesFilter(nightly, "  ", "forgerie")).toBe(true);
  });
  it("totals the list and its paused triggers", () => {
    expect(totalWords(manyList.triggers)).toBe("23 triggers, 4 paused");
    expect(totalWords([triage])).toBe("1 trigger");
  });
});

describe("the size plan", () => {
  it("moves the row between tiers one pixel either side of each threshold", () => {
    expect(triggersPlan(ROW_WIDE, 800, 800).row).toEqual({ tier: "wide", marks: 7, stateAction: "inline" });
    expect(triggersPlan(ROW_WIDE - 1, 800, 800).row).toEqual({ tier: "medium", marks: 7, stateAction: "menu" });
    expect(triggersPlan(ROW_NARROW, 800, 800).row.tier).toBe("medium");
    expect(triggersPlan(ROW_NARROW - 1, 800, 800).row).toEqual({ tier: "narrow", marks: 5, stateAction: "menu" });
  });
  it("moves the primary into ⋯ below a 20rem header, and cuts the error to 2 lines below a 22rem body", () => {
    expect(triggersPlan(672, HEADER_TIGHT, 800).primary).toBe("header");
    expect(triggersPlan(672, HEADER_TIGHT - 1, 800).primary).toBe("menu");
    expect(triggersPlan(672, 800, SHORT_BODY).errorLines).toBe(4);
    expect(triggersPlan(672, 800, SHORT_BODY - 1).errorLines).toBe(2);
  });
  it("spends less on spacing below a 22rem body", () => {
    expect(triggersPlan(672, 800, SHORT_BODY).density).toBe("roomy");
    expect(triggersPlan(672, 800, SHORT_BODY - 1).density).toBe("compact");
  });
  it("gives the ladder in the brief", () => {
    const ladder = [[672, 1440, 852], [672, 932, 505], [667, 704, 735], [672, 711, 326], [443, 475, 590], [320, 352, 735], [248, 280, 552]] as const;
    expect(ladder.map(([column, header, body]) => { const plan = triggersPlan(column, header, body); return `${plan.row.tier} ${plan.primary} ${String(plan.errorLines)}`; }))
      .toEqual(["wide header 4", "wide header 4", "wide header 4", "wide header 2", "medium header 4", "narrow header 4", "narrow menu 4"]);
  });
});
