import { Check } from "typebox/value";
import { expect, it } from "vitest";
import { TriggerSchema } from "../../shared/triggers.js";
import { migrateTriggerStore } from "./triggerMigration.js";

const oldStore = () => ({
  records: { night: {
    id: "night", incarnation: "incarnation", name: "Night", revision: 10, generation: 4,
    action: { kind: "workflow", cwd: "/current", workflow: "nightly", inputs: {} },
    schedule: { kind: "daily", at: "03:00", timezone: "UTC" }, state: { kind: "active", nextFireAt: 1000 },
    missedGraceMinutes: 360, createdAt: 0, createdBy: { kind: "user" }, attention: { since: 1 },
    history: [
      { occurrence: 1, requestId: "started", cause: "schedule", recordedAt: 2, skippedBefore: 0, outcome: { kind: "started", cwd: "/previous", sessionId: "s", runId: "r" } },
      { occurrence: 3, requestId: "failed", cause: "manual", recordedAt: 4, skippedBefore: 0, outcome: { kind: "failed", error: "quota", cwd: "/previous", sessionId: "failed-session" } },
      { occurrence: 5, requestId: "missed", cause: "schedule", recordedAt: 6, skippedBefore: 0, outcome: { kind: "missed" } },
      { occurrence: 7, requestId: "running", cause: "manual", recordedAt: 8, skippedBefore: 0, outcome: { kind: "running", startedAt: 7 } },
      { occurrence: 9, requestId: "no-session", cause: "manual", recordedAt: 10, skippedBefore: 0, outcome: { kind: "failed", error: "folder gone" } },
    ],
  } }, nextGeneration: 5, manualRequests: { receipt: { triggerId: "night", incarnation: "incarnation" } },
});

it("migrates every legacy history outcome and preserves saved historical destinations and receipts", () => {
  const old = oldStore();
  const migrated = migrateTriggerStore(old, 1);
  const trigger = migrated.records["night"];
  const { incarnation, ...publicRecord } = trigger ?? {};
  expect(Check(TriggerSchema, publicRecord)).toBe(true);
  expect(incarnation).toBe("incarnation");
  expect(trigger?.action.targets).toEqual({ kind: "projects", cwds: ["/current"] });
  expect(trigger?.history.map((fire) => fire.projects)).toEqual([
    [{ cwd: "/previous", outcome: { kind: "started", sessionId: "s", runId: "r" } }],
    [{ cwd: "/previous", outcome: { kind: "failed", error: "quota", sessionId: "failed-session" } }],
    [{ cwd: "/current", outcome: { kind: "missed" } }],
    [{ cwd: "/current", outcome: { kind: "running", startedAt: 7 } }],
    [{ cwd: "/current", outcome: { kind: "failed", error: "folder gone" } }],
  ]);
  expect(migrated.manualRequests).toEqual(old.manualRequests);
  expect(migrated.nextGeneration).toBe(5); expect(trigger?.generation).toBe(4); expect(trigger?.revision).toBe(10);
  expect(old.records.night.action).toHaveProperty("cwd");
});

it("refuses an unsupported version or corrupt old record instead of guessing", () => {
  expect(() => migrateTriggerStore(oldStore(), 0)).toThrow("Unsupported");
  expect(() => migrateTriggerStore({ records: {} }, 1)).toThrow("Unsupported");
});
