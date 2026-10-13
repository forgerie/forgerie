import { describe, expect, it } from "vitest";
import {
  argumentsText, askerOf, CATEGORY_LABEL, consequenceOf, firstLine, GATED_ACTION_TYPE, GATED_CATEGORIES, gatedActionSchema, gatedActionsSchema,
  gatedEntryOf, gatedIsWaiting, gatedMeta, gatedOutcome, saysMore, shownCall, sortGated,
} from "./gatedActionsModel";
import { GATED_NOW, PUSH, PUSH_ENTRY, PUSH_FAILED, PUSH_RAN, PUSH_REFUSED, PUSH_RUNNING, REPLY, REPLY_ENTRY, RESET } from "./fixtures/gatedActions";

const entry = (details: unknown, customType = GATED_ACTION_TYPE) => gatedEntryOf({ role: "custom", customType, content: "", details });

describe("a gated action's record", () => {
  it("takes each state the server writes", () => {
    for (const record of [PUSH, PUSH_RUNNING, PUSH_RAN, PUSH_FAILED, PUSH_REFUSED, RESET, REPLY]) expect(gatedActionSchema.parse(record)).toEqual(record);
    expect(gatedActionsSchema.parse([])).toEqual([]);
  });

  it("refuses a record it cannot read", () => {
    const { description: _description, ...noDescription } = PUSH;
    void _description;
    for (const sample of [
      noDescription, { ...PUSH, category: "deploy" }, { ...PUSH, state: { kind: "ran" } }, { ...PUSH, state: { kind: "failed", at: 1 } },
      { ...PUSH, state: { kind: "refused" } }, { ...PUSH, state: { kind: "withdrawn" } }, { ...PUSH, args: "git push -f" }, { ...PUSH, extra: 1 },
      { ...PUSH, requestedAt: "now" }, null, "record",
    ]) expect(gatedActionSchema.safeParse(sample).success, JSON.stringify(sample)).toBe(false);
  });

  it("lists newest first, then by id, without changing its input", () => {
    const older = { ...RESET, requestedAt: PUSH.requestedAt };
    const input = [REPLY, older, PUSH];
    expect(sortGated(input).map((record) => record.id)).toEqual(["g-2", "g-1", "g-3"]);
    expect(input.map((record) => record.id)).toEqual(["g-3", "g-2", "g-1"]);
  });
});

describe("the transcript entry", () => {
  it("reads the hook's entry", () => {
    expect(entry(PUSH_ENTRY)).toEqual(PUSH_ENTRY);
    expect(entry({ ...PUSH_ENTRY, extra: true })).toEqual(PUSH_ENTRY);
  });

  it("is not an entry under another type, or with details it cannot read", () => {
    expect(entry(PUSH_ENTRY, "forgerie.workflow-stop")).toBeUndefined();
    expect(gatedEntryOf({ role: "user", content: "", details: PUSH_ENTRY })).toBeUndefined();
    expect(entry({ ...PUSH_ENTRY, id: "" })).toBeUndefined();
    expect(entry({ ...PUSH_ENTRY, category: "deploy" })).toBeUndefined();
    expect(entry(undefined)).toBeUndefined();
  });
});

describe("what the card says", () => {
  it("names every category, and says what cannot be undone and what Approve does", () => {
    for (const category of GATED_CATEGORIES) {
      expect(CATEGORY_LABEL[category]).not.toBe("");
      expect(consequenceOf(category)).toMatch(/\. Approve runs it once, exactly as shown\.$/u);
    }
  });

  it("says who asked, with the parent named as such", () => {
    expect(askerOf("build")).toBe("build");
    expect(askerOf("parent")).toBe("the parent");
    expect(gatedMeta(PUSH_ENTRY)).toBe("Force-push, asked by build");
    expect(gatedMeta({ by: "parent", category: "publish" })).toBe("Publish, asked by the parent");
  });

  it("shows a shell call's exact command from the record, and the preview until it is read", () => {
    const shortened = { ...PUSH_ENTRY, preview: "git push --force-with-lease origin feat/…" };
    expect(shownCall(shortened, undefined)).toEqual({ code: shortened.preview, shell: true });
    expect(shownCall(shortened, PUSH)).toEqual({ code: "git push --force-with-lease origin feat/run-export", shell: true });
    expect(shownCall(shortened, { ...PUSH, args: {} })).toEqual({ code: shortened.preview, shell: true });
  });

  it("shows another tool's preview, with every argument one step away once the record is read", () => {
    expect(shownCall(REPLY_ENTRY, REPLY)).toEqual({ code: REPLY_ENTRY.preview, shell: false });
    expect(argumentsText(REPLY_ENTRY, REPLY)).toContain("\"text\": \"Yes, it ships in the original box with the charger and the S Pen.");
    expect(argumentsText(REPLY_ENTRY, undefined)).toBeUndefined();
    expect(argumentsText(REPLY_ENTRY, { ...REPLY, args: {} })).toBeUndefined();
    expect(argumentsText(PUSH_ENTRY, PUSH)).toBeUndefined();
  });

  it("waits until the record says otherwise; before the first read it trusts the entry", () => {
    expect(gatedIsWaiting(undefined, false)).toBe(true);
    expect(gatedIsWaiting(undefined, true)).toBe(false);
    expect(gatedIsWaiting(PUSH, true)).toBe(true);
    for (const record of [PUSH_RUNNING, PUSH_RAN, PUSH_FAILED, PUSH_REFUSED]) expect(gatedIsWaiting(record, true)).toBe(false);
  });

  it("closes to one line for each outcome", () => {
    expect(gatedOutcome(PUSH)).toBe("Waiting for a decision.");
    expect(gatedOutcome(PUSH_RUNNING)).toBe("Approved — running…");
    expect(gatedOutcome(PUSH_RAN)).toBe("Approved — ran");
    expect(gatedOutcome(PUSH_REFUSED)).toBe("Refused");
    expect(gatedOutcome(PUSH_FAILED)).toBe("Approved — failed: ! [rejected]        feat/run-export -> feat/run-export (stale info)");
    expect(gatedOutcome({ ...PUSH, state: { kind: "failed", error: "  ", at: GATED_NOW } })).toBe("Approved — failed");
    expect(gatedOutcome(undefined)).toBe("This action is no longer in the session's records.");
  });

  it("cuts a long first line, and knows when a text says more than it", () => {
    expect(firstLine("\n\n  fatal: no upstream  \nmore")).toBe("fatal: no upstream");
    expect(firstLine("x".repeat(200))).toHaveLength(160);
    expect(firstLine("x".repeat(200)).endsWith("…")).toBe(true);
    expect(saysMore("one line")).toBe(false);
    expect(saysMore("one\ntwo")).toBe(true);
    expect(saysMore("x".repeat(200))).toBe(true);
  });
});
