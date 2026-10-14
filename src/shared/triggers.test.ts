import { Check } from "typebox/value";
import { expect, it } from "vitest";
import { KNOWN_THINKING_LEVELS } from "./thinkingLevels.js";
import { TriggerActionSchema, TriggerProjectFireSchema, triggerFireSummary, triggerManualRequestId, type TriggerAction } from "./triggers.js";

type KnownLevel = (typeof KNOWN_THINKING_LEVELS)[number];
type ActionLevel = NonNullable<TriggerAction["thinkingLevel"]>;
// Both directions catch added, removed, or widened levels in either source.
const levelsMatch: [Exclude<KnownLevel, ActionLevel>, Exclude<ActionLevel, KnownLevel>] extends [never, never] ? true : never = true;
void levelsMatch;

const workflow: TriggerAction = { kind: "workflow", targets: { kind: "projects", cwds: ["/work/repo"] }, workflow: "nightly", inputs: {} };

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

it("requires nonempty fixed targets and refuses cwd on the wire", () => {
  expect(Check(TriggerActionSchema, { ...workflow, targets: { kind: "projects", cwds: [] } })).toBe(false);
  expect(Check(TriggerActionSchema, { ...workflow, targets: { kind: "all" } })).toBe(true);
  expect(Check(TriggerActionSchema, { ...workflow, cwd: "/work/repo" })).toBe(false);
});


it("counts per-project results for a partial fire summary", () => {
  expect(triggerFireSummary({ projects: [
    { cwd: "/one", outcome: { kind: "started", sessionId: "s", runId: "r" } },
    { cwd: "/two", outcome: { kind: "failed", error: "quota" } },
    { cwd: "/three", outcome: { kind: "unavailable", reason: "folder gone" } },
    { cwd: "/four", outcome: { kind: "running", startedAt: 0 } },
  ] })).toEqual({ total: 4, started: 1, failed: 1, unavailable: 1, running: 1, missed: 0 });
});


it("accepts legacy unstamped project outcomes and the new recorded timestamps", () => {
  for (const outcome of [
    { kind: "failed", error: "quota" },
    { kind: "failed", error: "quota", failedAt: 1000 },
    { kind: "missed" },
    { kind: "missed", missedAt: 1000 },
  ]) expect(Check(TriggerProjectFireSchema, { cwd: "/project", outcome })).toBe(true);
  expect(Check(TriggerProjectFireSchema, { cwd: "/project", outcome: { kind: "failed", error: "quota", failedAt: "1000" } })).toBe(false);
});
