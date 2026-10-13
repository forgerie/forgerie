import { Check } from "typebox/value";
import { expect, it } from "vitest";
import { KNOWN_THINKING_LEVELS } from "./thinkingLevels.js";
import { TriggerActionSchema, triggerManualRequestId, type TriggerAction } from "./triggers.js";

type KnownLevel = (typeof KNOWN_THINKING_LEVELS)[number];
type ActionLevel = NonNullable<TriggerAction["thinkingLevel"]>;
// Both directions catch added, removed, or widened levels in either source.
const levelsMatch: [Exclude<KnownLevel, ActionLevel>, Exclude<ActionLevel, KnownLevel>] extends [never, never] ? true : never = true;
void levelsMatch;

const workflow = { kind: "workflow", cwd: "/work/repo", workflow: "nightly", inputs: {} } as const;

it.each(KNOWN_THINKING_LEVELS)("accepts and types the known thinking level %s", (thinkingLevel) => {
  const action: TriggerAction = { ...workflow, thinkingLevel };
  expect(Check(TriggerActionSchema, action)).toBe(true);
});

it("keeps thinking optional and rejects unknown levels", () => {
  const action: TriggerAction = workflow;
  expect(Check(TriggerActionSchema, action)).toBe(true);
  expect(Check(TriggerActionSchema, { ...workflow, thinkingLevel: "ultra" })).toBe(false);
});


it("separates manual request tuples that previously had the same joined string", () => {
  const first = triggerManualRequestId("alpha", "beta-run-gamma");
  const second = triggerManualRequestId("alpha-run-beta", "gamma");
  expect(first).not.toBe(second);
  expect(first).toMatch(/^[a-zA-Z0-9-]{1,128}$/u);
  expect(second).toMatch(/^[a-zA-Z0-9-]{1,128}$/u);
  expect(triggerManualRequestId("a".repeat(48), "b".repeat(64))).toMatch(/^[a-zA-Z0-9-]{1,128}$/u);
});
