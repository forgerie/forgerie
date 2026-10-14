import { describe, expect, it } from "vitest";
import type { Trigger } from "@shared/triggers";
import {
  attentionTone, groupTriggers, HEADER_TIGHT, matchesFilter, readTriggersPlace, ROW_NARROW, ROW_WIDE, SHORT_BODY, totalWords, triggerEntry,
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
