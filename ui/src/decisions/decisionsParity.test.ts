import { describe, expect, expectTypeOf, it } from "vitest";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import { DecisionConfirmSchema, DecisionKindSchema, DecisionOverturnSchema, DecisionSchema, DecisionStateSchema, type Decision as SharedDecision } from "@shared/decisions";
import { decisionConfirmSchema, decisionKindSchema, decisionOverturnSchema, decisionSchema, decisionStateSchema, type Decision } from "./decisionsModel";
import { ANSWER, OVERTURNED, SESSION_ANSWER } from "./fixtures/decisions";

/** Both sides must take and refuse the same values. */
function agree(name: string, zod: { safeParse: (value: unknown) => { success: boolean } }, typebox: TSchema, samples: readonly unknown[]) {
  for (const sample of samples) expect(zod.safeParse(sample).success, `${name}: ${JSON.stringify(sample)?.slice(0, 120) ?? String(sample)}`).toBe(Check(typebox, sample));
}

describe("the decision log mirrors the server's schema (src/shared/decisions.ts)", () => {
  it("has the server's type", () => {
    expectTypeOf<Decision>().toEqualTypeOf<SharedDecision>();
  });

  it("takes and refuses the same decisions", () => {
    const { runId: _runId, ...noRun } = ANSWER;
    void _runId;
    const { reason: _reason, ...noReason } = ANSWER;
    void _reason;
    const samples: unknown[] = [
      ANSWER, OVERTURNED, SESSION_ANSWER, noRun, { ...ANSWER, id: "" }, { ...ANSWER, id: "d:q:41" }, { ...ANSWER, by: "user" },
      { ...ANSWER, flagged: true, kind: "guess" }, { ...ANSWER, at: 0 }, { ...ANSWER, at: -1.5 },
      // Refused by both.
      noReason, { ...ANSWER, extra: 1 }, { ...ANSWER, runId: null }, { ...ANSWER, runId: 7 }, { ...ANSWER, at: "now" }, { ...ANSWER, flagged: 1 },
      { ...ANSWER, kind: "hunch" }, { ...ANSWER, by: null }, { ...ANSWER, state: { kind: "standing", note: "x" } },
      { ...ANSWER, state: { kind: "overturned", note: "x" } }, { ...ANSWER, state: { kind: "overturned", note: "x", at: 1, by: "user" } },
      null, [], "decision",
    ];
    agree("decision", decisionSchema, DecisionSchema, samples);
    for (const sample of [noReason, { ...ANSWER, extra: 1 }, { ...ANSWER, runId: null }]) expect(decisionSchema.safeParse(sample).success).toBe(false);
  });

  it("takes and refuses the same kinds and states", () => {
    agree("kind", decisionKindSchema, DecisionKindSchema, ["child-answer", "guess", "gated", "auto-stop", "issue", "Guess", "", "auto_stop", 1, null]);
    agree("state", decisionStateSchema, DecisionStateSchema, [
      { kind: "confirmed", at: 0 }, { kind: "confirmed" }, { kind: "confirmed", at: "now" }, { kind: "confirmed", at: 0, note: "yes" },
      { kind: "standing" }, { kind: "overturned", note: "", at: 0 }, { kind: "overturned", note: "Group by stage.", at: 1791502400000 },
      { kind: "standing", at: 1 }, { kind: "overturned", note: "x" }, { kind: "overturned", at: 1 }, { kind: "overturned", note: 1, at: 1 }, { kind: "withdrawn" }, {},
    ]);
  });

  it("sends a confirmation body the route takes", () => {
    agree("confirm", decisionConfirmSchema, DecisionConfirmSchema, [
      { cwd: "/srv/app" }, { cwd: "" }, {}, { cwd: "/srv/app", note: "yes" }, null, { cwd: 1 },
    ]);
  });

  it("sends an overturn body the route takes", () => {
    agree("overturn", decisionOverturnSchema, DecisionOverturnSchema, [
      { cwd: "/srv/app", note: "Group by stage." }, { cwd: "/srv/app", note: "x".repeat(8000) }, { cwd: "/srv/app", note: " " },
      { cwd: "/srv/app", note: "x".repeat(8001) }, { cwd: "/srv/app", note: "" }, { cwd: "", note: "x" }, { note: "x" }, { cwd: "/srv/app" },
      { cwd: "/srv/app", note: "x", extra: true },
    ]);
  });
});
