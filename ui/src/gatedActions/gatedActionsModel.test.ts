import { describe, expect, it } from "vitest";
import {
  argumentsText, askerOf, batchApprovable, CATEGORY_LABEL, consequenceOf, errorText, firstLine, GATED_ACTION_TYPE, GATED_CATEGORIES, gatedActionSchema, gatedActionsSchema,
  gatedEntryOf, gatedIsWaiting, gatedMeta, gatedOutcome, resultText, saysMore, shownCall, sortGated, unknownOutcome,
} from "./gatedActionsModel";
import {
  GATED_NOW, PUSH, PUSH_ENTRY, PUSH_FAILED, PUSH_RAN, PUSH_REFUSED, PUSH_RUNNING, PUSH_UNKNOWN, REPLY, REPLY_ENTRY, RESET,
} from "./fixtures/gatedActions";

const entry = (details: unknown, customType = GATED_ACTION_TYPE) => gatedEntryOf({ role: "custom", customType, content: "", details });

describe("a gated action's record", () => {
  it("takes each state the server writes", () => {
    for (const record of [PUSH, PUSH_RUNNING, PUSH_RAN, PUSH_FAILED, PUSH_UNKNOWN, PUSH_REFUSED, RESET, REPLY]) expect(gatedActionSchema.parse(record)).toEqual(record);
    expect(gatedActionsSchema.parse([])).toEqual([]);
  });

  it("lists newest first, then by id, without changing its input", () => {
    const sameTime = { ...RESET, requestedAt: PUSH.requestedAt };
    const input = [REPLY, sameTime, PUSH];
    expect(sortGated(input).map((record) => record.id)).toEqual([PUSH.id, RESET.id, REPLY.id]);
    expect(input.map((record) => record.id)).toEqual([REPLY.id, RESET.id, PUSH.id]);
  });
});

describe("the transcript entry", () => {
  it("reads the hook's entry, and drops the fields the session file stamps into it", () => {
    expect(entry(PUSH_ENTRY)).toEqual(PUSH_ENTRY);
    expect(entry({ ...PUSH_ENTRY, durableSessionId: "s-1", durableEntryId: 7, durableJournalId: "j", durableConversationId: 1, durableMessageIndex: 0 })).toEqual(PUSH_ENTRY);
  });

  it("is not an entry under another type, or with details it cannot read", () => {
    expect(entry(PUSH_ENTRY, "forgerie.workflow-stop")).toBeUndefined();
    expect(gatedEntryOf({ role: "user", content: "", details: PUSH_ENTRY })).toBeUndefined();
    expect(entry({ ...PUSH_ENTRY, id: "" })).toBeUndefined();
    expect(entry({ ...PUSH_ENTRY, category: "deploy" })).toBeUndefined();
    const { command: _command, ...noCommand } = PUSH_ENTRY;
    void _command;
    expect(entry({ ...noCommand, preview: PUSH_ENTRY.command })).toBeUndefined();
    expect(entry(undefined)).toBeUndefined();
  });
});

describe("what the card says", () => {
  it("names every category with the shared label, and says what cannot be undone and what Approve does", () => {
    expect(CATEGORY_LABEL["force-push"]).toBe("Force-push, or push all or unknown branches");
    expect(CATEGORY_LABEL["push-default"]).toBe("Push to the default branch");
    for (const category of GATED_CATEGORIES) {
      expect(CATEGORY_LABEL[category]).not.toBe("");
      expect(consequenceOf(category)).toMatch(/\. Approve runs it once, exactly as shown\.$/u);
    }
  });

  it("says who asked: a child by its name, and the parent named as such", () => {
    expect(askerOf("child build")).toBe("build");
    expect(askerOf("child 42")).toBe("42");
    expect(askerOf("parent")).toBe("the parent");
    expect(askerOf("build")).toBe("build");
    expect(askerOf("child ")).toBe("child ");
    expect(gatedMeta(PUSH_ENTRY)).toBe("Force-push, or push all or unknown branches, asked by build");
    expect(gatedMeta({ by: "parent", category: "publish" })).toBe("Publish packages or releases, asked by the parent");
  });

  it("shows a shell call's whole command from the record, and the entry's command until it is read", () => {
    const shortened = { ...PUSH_ENTRY, command: "git push --force-with-lease origin feat/…" };
    expect(shownCall(shortened, undefined)).toEqual({ code: shortened.command, shell: true });
    expect(shownCall(shortened, PUSH)).toEqual({ code: "git push --force-with-lease origin feat/run-export", shell: true });
    expect(shownCall(shortened, { ...PUSH, args: {} })).toEqual({ code: shortened.command, shell: true });
  });

  it("shows another tool's call as the entry has it, with every argument one step away once the record is read", () => {
    expect(shownCall(REPLY_ENTRY, REPLY)).toEqual({ code: REPLY_ENTRY.command, shell: false });
    expect(argumentsText(REPLY_ENTRY, REPLY)).toContain("\"text\": \"Yes, it ships in the original box with the charger and the S Pen.");
    expect(argumentsText(REPLY_ENTRY, undefined)).toBeUndefined();
    expect(argumentsText(REPLY_ENTRY, { ...REPLY, args: {} })).toBeUndefined();
    expect(argumentsText(PUSH_ENTRY, PUSH)).toBeUndefined();
  });

  it("waits until the record says otherwise; before the first read it trusts the entry", () => {
    expect(gatedIsWaiting(undefined, false)).toBe(true);
    expect(gatedIsWaiting(undefined, true)).toBe(false);
    expect(gatedIsWaiting(PUSH, true)).toBe(true);
    for (const record of [PUSH_RUNNING, PUSH_RAN, PUSH_FAILED, PUSH_UNKNOWN, PUSH_REFUSED]) expect(gatedIsWaiting(record, true)).toBe(false);
  });

  it("closes to one line for each outcome", () => {
    expect(gatedOutcome(PUSH)).toBe("Waiting for a decision.");
    expect(gatedOutcome(PUSH_RUNNING)).toBe("Approved — running…");
    expect(gatedOutcome(PUSH_RAN)).toBe("Approved — ran");
    expect(gatedOutcome(PUSH_REFUSED)).toBe("Refused");
    expect(gatedOutcome(PUSH_FAILED)).toBe("Approved — failed: ! [rejected]        feat/run-export -> feat/run-export (stale info)");
    expect(gatedOutcome({ ...PUSH, state: { kind: "failed", error: "The conversation cwd changed since this action was blocked; the action was not run", at: GATED_NOW } }))
      .toBe("Approved — failed: The conversation cwd changed since this action was blocked; the action was not run");
    expect(gatedOutcome({ ...PUSH, state: { kind: "failed", error: "  ", at: GATED_NOW } })).toBe("Approved — failed");
    expect(gatedOutcome(undefined)).toBe("This action is no longer in the session's records.");
  });

  it("says an interrupted run's outcome is unknown, and keeps the server's advice for under the line", () => {
    expect(gatedOutcome(PUSH_UNKNOWN)).toBe("Approved — outcome unknown: the approved action was interrupted and may have run");
    expect(unknownOutcome(PUSH_UNKNOWN)).toEqual({
      lead: "the approved action was interrupted and may have run",
      rest: "It will not be run again. Check its effects before requesting another action.",
    });
    const stopped = { ...PUSH, state: { kind: "failed" as const, error: "Unknown outcome: approved action stopped; it will not be run again.", at: GATED_NOW } };
    expect(gatedOutcome(stopped)).toBe("Approved — outcome unknown: approved action stopped; it will not be run again");
    expect(unknownOutcome(stopped)?.rest).toBe("");
    expect(unknownOutcome(PUSH_FAILED)).toBeUndefined();
    expect(unknownOutcome(PUSH_RAN)).toBeUndefined();
  });

  it("reads a tool's JSON result as its text, and anything else as JSON", () => {
    expect(resultText(PUSH_RAN.state.kind === "ran" ? PUSH_RAN.state.result : undefined)).toMatch(/^Enumerating objects[\s\S]*\(forced update\)$/u);
    expect(resultText({ content: [{ type: "text", text: "one" }, { type: "image", data: "…" }, { type: "text", text: "two" }] })).toBe("one\ntwo");
    expect(resultText({ content: [{ type: "image", data: "x" }], details: { id: 4 } })).toContain("\"details\"");
    expect(resultText("plain")).toBe("plain");
    expect(resultText(null)).toBe("");
    expect(resultText({ merged: true })).toBe("{\n  \"merged\": true\n}");
  });

  it("reads a failed tool's saved result as its text, and a plain error as it is", () => {
    expect(PUSH_FAILED.state.kind === "failed" && errorText(PUSH_FAILED.state.error)).toMatch(/^! \[rejected\][\s\S]*push again\.$/u);
    expect(errorText("Approved tool bash is no longer available")).toBe("Approved tool bash is no longer available");
    expect(errorText("{\"not\":\"a result\"}")).toBe("{\"not\":\"a result\"}");
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

describe("approving several waiting calls at once", () => {
  it("offers two or more calls whose records still wait, and nothing it cannot prove", () => {
    expect(batchApprovable([PUSH_ENTRY, RESET], [PUSH, RESET], false)).toEqual([PUSH.id, RESET.id]);
    expect(batchApprovable([PUSH_ENTRY, RESET], [PUSH_RUNNING, RESET], false)).toEqual([]);
    expect(batchApprovable([PUSH_ENTRY], [PUSH], false)).toEqual([]);
    expect(batchApprovable([PUSH_ENTRY, RESET], undefined, false)).toEqual([]);
    expect(batchApprovable([PUSH_ENTRY, RESET], [PUSH, RESET], true)).toEqual([]);
  });
});
