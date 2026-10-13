import { Check } from "typebox/value";
import { expect, it } from "vitest";
import { AutonomyPolicySchema, GatedCategorySchema, defaultAutonomyPolicy, defaultAutonomyPolicySource, gatedCategoryLabels } from "./autonomyPolicy.js";
it("has one label and a gated default per schema category, with no automatic stops", async () => {
  expect(Check(AutonomyPolicySchema, defaultAutonomyPolicy)).toBe(true);
  expect(Object.keys(gatedCategoryLabels).sort()).toEqual(Object.keys(defaultAutonomyPolicy.gated).sort());
  for (const [category, enabled] of Object.entries(defaultAutonomyPolicy.gated)) { expect(Check(GatedCategorySchema, category)).toBe(true); expect(enabled).toBe(true); }
  expect(defaultAutonomyPolicy.autoPassStops).toBe(false);
  const policy = await defaultAutonomyPolicySource.read("/repo"); policy.gated.publish = false;
  expect((await defaultAutonomyPolicySource.read("/other")).gated.publish).toBe(true);
});
