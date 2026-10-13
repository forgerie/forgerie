import { describe, expect, expectTypeOf, it } from "vitest";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import {
  GATED_ACTION_ENTRY_KIND, GatedActionEntrySchema, GatedActionSchema, GatedActionStateSchema,
  type GatedAction as SharedGatedAction, type GatedActionEntry as SharedGatedActionEntry, type GatedActionState as SharedGatedActionState,
} from "@shared/gatedActions";
import {
  AutonomyPolicySchema, defaultAutonomyPolicy, GatedCategorySchema,
  type AutonomyPolicy as SharedAutonomyPolicy, type GatedCategory as SharedGatedCategory,
} from "@shared/autonomyPolicy";
import {
  autonomyPolicySchema, GATED_ACTION_TYPE, GATED_CATEGORIES, gatedActionEntrySchema, gatedActionSchema, gatedActionStateSchema, gatedCategorySchema,
  type AutonomyPolicy, type GatedAction, type GatedActionEntry, type GatedActionState, type GatedCategory,
} from "./gatedActionsModel";
import { PUSH, PUSH_ENTRY, PUSH_FAILED, PUSH_RAN, PUSH_REFUSED, PUSH_RUNNING, PUSH_UNKNOWN, REPLY, REPLY_ENTRY } from "./fixtures/gatedActions";

/** Both sides must take and refuse the same values. */
function agree(name: string, zod: { safeParse: (value: unknown) => { success: boolean } }, typebox: TSchema, samples: readonly unknown[]) {
  for (const sample of samples) expect(zod.safeParse(sample).success, `${name}: ${JSON.stringify(sample)?.slice(0, 120) ?? String(sample)}`).toBe(Check(typebox, sample));
}

describe("gated actions mirror the server's schema (src/shared/gatedActions.ts, src/shared/autonomyPolicy.ts)", () => {
  it("has the server's types", () => {
    expectTypeOf<GatedCategory>().toEqualTypeOf<SharedGatedCategory>();
    expectTypeOf<AutonomyPolicy>().toEqualTypeOf<SharedAutonomyPolicy>();
    expectTypeOf<GatedActionState>().toEqualTypeOf<SharedGatedActionState>();
    expectTypeOf<GatedAction>().toEqualTypeOf<SharedGatedAction>();
    expectTypeOf<GatedActionEntry>().toEqualTypeOf<SharedGatedActionEntry>();
    expect(GATED_ACTION_TYPE).toBe(GATED_ACTION_ENTRY_KIND);
  });

  it("takes and refuses the same categories", () => {
    agree("category", gatedCategorySchema, GatedCategorySchema, [...GATED_CATEGORIES, "deploy", "Force-push", "", null, 1]);
  });

  it("takes and refuses the same states", () => {
    agree("state", gatedActionStateSchema, GatedActionStateSchema, [
      ...[PUSH, PUSH_RUNNING, PUSH_RAN, PUSH_FAILED, PUSH_UNKNOWN, PUSH_REFUSED].map((record) => record.state),
      { kind: "ran", result: null, at: 1 }, { kind: "ran", result: "text", at: 1 }, { kind: "ran", result: [1, 2], at: 0 },
      // Refused by both.
      { kind: "ran", at: 1 }, { kind: "ran", result: {}, at: "now" }, { kind: "failed", error: "x" }, { kind: "failed", error: 1, at: 1 },
      { kind: "refused", at: 1 }, { kind: "approved", at: 1 }, { kind: "waiting", note: "" }, { kind: "withdrawn" }, {}, null,
    ]);
  });

  it("takes and refuses the same records", () => {
    const { description: _description, ...noDescription } = PUSH;
    void _description;
    agree("record", gatedActionSchema, GatedActionSchema, [
      PUSH, PUSH_RAN, PUSH_FAILED, REPLY, { ...PUSH, args: {} }, { ...PUSH, args: { nested: { a: [1] } } }, { ...PUSH, id: "" }, { ...PUSH, requestedAt: 0 },
      // Refused by both.
      noDescription, { ...PUSH, conversationId: 0 }, { ...PUSH, conversationId: 1.5 }, { ...PUSH, conversationId: "21" }, { ...PUSH, args: "git push -f" },
      { ...PUSH, args: [] }, { ...PUSH, args: null }, { ...PUSH, category: "deploy" }, { ...PUSH, extra: 1 }, { ...PUSH, requestedAt: "now" },
      { ...PUSH, state: { kind: "refused", at: 1 } }, null, [], "record",
    ]);
  });

  it("takes and refuses the same transcript entries", () => {
    agree("entry", gatedActionEntrySchema, GatedActionEntrySchema, [
      PUSH_ENTRY, REPLY_ENTRY, { ...PUSH_ENTRY, id: "" }, { ...PUSH_ENTRY, command: "" },
      { ...PUSH_ENTRY, preview: "x" }, { ...PUSH_ENTRY, category: "deploy" }, { ...PUSH_ENTRY, command: 1 }, { id: "g", by: "parent" }, null,
    ]);
  });

  it("takes and refuses the same policies", () => {
    agree("policy", autonomyPolicySchema, AutonomyPolicySchema, [
      defaultAutonomyPolicy, { ...defaultAutonomyPolicy, autoPassStops: true }, { ...defaultAutonomyPolicy, gated: { ...defaultAutonomyPolicy.gated, publish: false } },
      { ...defaultAutonomyPolicy, version: 2 }, { ...defaultAutonomyPolicy, gated: { ...defaultAutonomyPolicy.gated, deploy: true } },
      { ...defaultAutonomyPolicy, gated: { "force-push": true } }, { ...defaultAutonomyPolicy, extra: 1 }, { version: 1, gated: defaultAutonomyPolicy.gated }, null,
    ]);
  });
});
