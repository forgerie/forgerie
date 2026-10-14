import { Type } from "typebox";
import { Check } from "typebox/value";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TriggerFireSchema, type Trigger } from "../../shared/triggers.js";
import { durableTriggers, listTriggers, TriggerError, type TriggerFireReceipt, type ProjectTriggerFireRequest, type DurableTriggerOptions } from "./durableTriggers.js";

const at = (value: string) => Date.parse(value);
const nightly = {
  id: "nightly", name: "Nightly refinement",
  schedule: { kind: "daily", at: "03:00", timezone: "UTC" },
  action: { kind: "workflow", targets: { kind: "projects", cwds: ["/work/repo"] }, workflow: "nightly-refine", inputs: { scope: "yesterday" } },
} as const;

/** Close enough to 03:00 that the first fire happens during the test, far enough that opening never passes it. */
const JUST_BEFORE_THREE = "2026-10-13T02:59:59.850Z";

/** A wall clock that runs at real speed from a chosen instant, so Durable sleeps end in milliseconds. */
function shiftedClock(start: string) {
  let shift = at(start) - Date.now();
  return { now: () => Date.now() + shift, set: (instant: string) => { shift = at(instant) - Date.now(); } };
}

type FireBehavior = { kind: "start" } | { kind: "fail"; error: string } | { kind: "hold-until-cancelled" };
/** The host's fire step with a configurable outcome. It records every request it receives. */
function recordingFire(behavior: FireBehavior) {
  const requests: ProjectTriggerFireRequest[] = [];
  const fire = async (request: ProjectTriggerFireRequest, signal: Context): Promise<TriggerFireReceipt> => {
    requests.push(request);
    if (behavior.kind === "fail") throw new Error(behavior.error);
    if (behavior.kind === "hold-until-cancelled") {
      await new Promise<never>((_resolve, reject) => {
        signal.abortSignal?.addEventListener("abort", () => { reject(new Error("cancelled")); }, { once: true });
      });
    }
    return { cwd: request.action.cwd, sessionId: `session-${String(requests.length)}`, runId: `run-${request.requestId}` };
  };
  return { requests, fire };
}

let directory: string;
const open: Harness[] = [];
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "forgerie-triggers-")); });
afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close(context);
  await rm(directory, { recursive: true, force: true });
});

async function openHost(clock: ReturnType<typeof shiftedClock>, fire: ReturnType<typeof recordingFire>["fire"], beforeAdmission?: DurableTriggerOptions["beforeAdmission"], extra: Pick<DurableTriggerOptions, "resolveProjects"> = {}) {
  const triggers = durableTriggers({ fire, now: clock.now, ...extra, ...(beforeAdmission === undefined ? {} : { beforeAdmission }) });
  const registry = createRegistry();
  registry.install(triggers.extension);
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, "triggers.sqlite")), { models: createModels(), registry, now: clock.now }, context);
  open.push(harness);
  const anchor = (await harness.root(context)).id;
  await triggers.initialize(harness, context);
  harness.resume();
  return { harness, anchor, triggers };
}
async function closeHost(harness: Harness) {
  open.splice(open.indexOf(harness), 1);
  await harness.close(context);
}
async function until(harness: Harness, done: (triggers: Trigger[]) => boolean): Promise<Trigger[]> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const triggers = await listTriggers(harness, context);
    if (done(triggers)) return triggers;
    if (Date.now() > deadline) throw new Error(`Timed out. Last state: ${JSON.stringify(triggers)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const fired = (count: number) => (triggers: Trigger[]) => (triggers[0]?.history.filter((entry) => entry.outcome.kind !== "running").length ?? 0) >= count;

it("fires at the occurrence with a per-occurrence request ID, records it, and arms the next day", async () => {
  const clock = shiftedClock("2026-10-13T02:59:59.950Z");
  const host = recordingFire({ kind: "start" });
  const { harness, anchor, triggers } = await openHost(clock, host.fire);
  clock.set(JUST_BEFORE_THREE);
  const created = await triggers.create(harness, anchor, nightly, context);
  expect(created.state).toEqual({ kind: "active", nextFireAt: at("2026-10-13T03:00:00Z") });

  const [trigger] = await until(harness, fired(1));
  const occurrence = at("2026-10-13T03:00:00Z");
  expect(host.requests).toEqual([{ triggerId: "nightly", name: "Nightly refinement", action: { kind: "workflow", cwd: "/work/repo", workflow: "nightly-refine", inputs: { scope: "yesterday" } }, cwds: ["/work/repo"], timezone: "UTC", occurrence, requestId: `trigger-nightly-${String(occurrence)}` }]);
  expect(trigger?.history[0]).toMatchObject({ occurrence, skippedBefore: 0, outcome: { kind: "started", sessionId: "session-1", runId: `run-trigger-nightly-${String(occurrence)}` } });
  expect(trigger?.state).toEqual({ kind: "active", nextFireAt: at("2026-10-14T03:00:00Z") });
});

it("reruns an interrupted fire after a restart with the same request ID, and records it once", async () => {
  const clock = shiftedClock("2026-10-13T02:59:59.950Z");
  const held = recordingFire({ kind: "hold-until-cancelled" });
  const first = await openHost(clock, held.fire);
  clock.set(JUST_BEFORE_THREE);
  await first.triggers.create(first.harness, first.anchor, nightly, context);
  const deadline = Date.now() + 5000;
  while (held.requests.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(held.requests).toHaveLength(1);
  await closeHost(first.harness);

  const host = recordingFire({ kind: "start" });
  const second = await openHost(clock, host.fire);
  const [trigger] = await until(second.harness, fired(1));
  expect(host.requests.map((request) => request.requestId)).toEqual([held.requests[0]?.requestId]);
  expect(trigger?.history).toHaveLength(1);
  expect(trigger?.history[0]?.outcome.kind).toBe("started");
});

it("after downtime inside the grace window, fires only the latest missed occurrence", async () => {
  const clock = shiftedClock("2026-10-12T12:00:00Z");
  const idle = recordingFire({ kind: "start" });
  const first = await openHost(clock, idle.fire);
  await first.triggers.create(first.harness, first.anchor, nightly, context);
  await closeHost(first.harness);

  clock.set("2026-10-16T05:00:00Z");
  const host = recordingFire({ kind: "start" });
  const second = await openHost(clock, host.fire);
  const [trigger] = await until(second.harness, fired(1));
  expect(idle.requests).toEqual([]);
  expect(host.requests.map((request) => request.occurrence)).toEqual([at("2026-10-16T03:00:00Z")]);
  expect(trigger?.history[0]).toMatchObject({ occurrence: at("2026-10-16T03:00:00Z"), skippedBefore: 3, outcome: { kind: "started" } });
  expect(trigger?.state).toEqual({ kind: "active", nextFireAt: at("2026-10-17T03:00:00Z") });
});

it("after downtime past the grace window, records a missed occurrence and fires nothing", async () => {
  const clock = shiftedClock("2026-10-12T12:00:00Z");
  const first = await openHost(clock, recordingFire({ kind: "start" }).fire);
  await first.triggers.create(first.harness, first.anchor, nightly, context);
  await closeHost(first.harness);

  clock.set("2026-10-16T12:00:00Z");
  const host = recordingFire({ kind: "start" });
  const second = await openHost(clock, host.fire);
  const [trigger] = await until(second.harness, fired(1));
  expect(host.requests).toEqual([]);
  expect(trigger?.history[0]).toMatchObject({ occurrence: at("2026-10-16T03:00:00Z"), skippedBefore: 3, outcome: { kind: "missed" } });
  expect(trigger?.state).toEqual({ kind: "active", nextFireAt: at("2026-10-17T03:00:00Z") });
});

it("records a failed fire and still arms the next occurrence", async () => {
  const clock = shiftedClock("2026-10-13T02:59:59.950Z");
  const host = recordingFire({ kind: "fail", error: "Workflow nightly-refine was not found" });
  const { harness, anchor, triggers } = await openHost(clock, host.fire);
  clock.set(JUST_BEFORE_THREE);
  await triggers.create(harness, anchor, nightly, context);
  const [trigger] = await until(harness, fired(1));
  expect(trigger?.history[0]?.outcome).toEqual({ kind: "failed", error: "Workflow nightly-refine was not found" });
  expect(trigger?.state).toEqual({ kind: "active", nextFireAt: at("2026-10-14T03:00:00Z") });
});

it("does not fire a paused trigger, and resumes from the current time", async () => {
  const clock = shiftedClock("2026-10-13T02:59:59.900Z");
  const host = recordingFire({ kind: "start" });
  const { harness, anchor, triggers } = await openHost(clock, host.fire);
  clock.set(JUST_BEFORE_THREE);
  await triggers.create(harness, anchor, nightly, context);
  const paused = await triggers.pause(harness, "nightly", context);
  expect(paused.state.kind).toBe("paused");
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(host.requests).toEqual([]);

  const resumed = await triggers.resume(harness, anchor, "nightly", context);
  expect(resumed.generation).toBeGreaterThan(paused.generation);
  expect(resumed.state).toEqual({ kind: "active", nextFireAt: at("2026-10-14T03:00:00Z") });
  expect(resumed.history).toEqual([]);
});

it("refuses a duplicate ID and invalid input, and removes a trigger", async () => {
  const clock = shiftedClock("2026-10-12T12:00:00Z");
  const { harness, anchor, triggers } = await openHost(clock, recordingFire({ kind: "start" }).fire);
  await triggers.create(harness, anchor, nightly, context);
  await expect(triggers.create(harness, anchor, nightly, context)).rejects.toThrow(TriggerError);
  await expect(triggers.create(harness, anchor, { ...nightly, id: "Has Spaces" }, context)).rejects.toThrow(TriggerError);
  await expect(triggers.create(harness, anchor, { ...nightly, id: "other", schedule: { kind: "daily", at: "03:00", timezone: "Nowhere/Here" } }, context)).rejects.toThrow("Unknown time zone");
  await triggers.remove(harness, "nightly", context);
  expect(await listTriggers(harness, context)).toEqual([]);
  const named = await triggers.create(harness, anchor, { ...nightly, id: "constructor" }, context);
  expect(named.id).toBe("constructor");
  await triggers.pause(harness, named.id, context);
  await triggers.remove(harness, named.id, context);
});

it("stores running before firing, preserves the entry on restart, and increments revision", async () => {
  const clock = shiftedClock("2026-10-12T12:00:00Z");
  const held = recordingFire({ kind: "hold-until-cancelled" });
  const first = await openHost(clock, held.fire);
  const created = await first.triggers.create(first.harness, first.anchor, nightly, context);
  await first.triggers.pause(first.harness, created.id, context);
  await first.triggers.run(first.harness, first.anchor, created.id, "one", context);
  const [running] = await until(first.harness, (records) => records[0]?.history[0]?.outcome.kind === "running");
  expect(running?.revision).toBe(3);
  expect(running?.history[0]?.cause).toBe("manual");
  await closeHost(first.harness);
  const started = recordingFire({ kind: "start" });
  const second = await openHost(clock, started.fire);
  await second.triggers.run(second.harness, second.anchor, created.id, "one", context);
  const [finished] = await until(second.harness, fired(1));
  expect(finished?.history).toHaveLength(1);
  expect(finished?.state.kind).toBe("paused");
  expect(finished?.revision).toBe(5);
  expect(started.requests).toHaveLength(1);
});

it("derives collision-safe slugs and keeps history and creator through re-arming edits", async () => {
  const clock = shiftedClock("2026-10-12T12:00:00Z");
  const { harness, anchor, triggers } = await openHost(clock, recordingFire({ kind: "start" }).fire);
  const input = { name: nightly.name, schedule: nightly.schedule, action: nightly.action };
  const first = await triggers.create(harness, anchor, input, context, { kind: "agent", sessionId: "parent", cwd: "/work/repo" });
  const second = await triggers.create(harness, anchor, input, context);
  expect(first.id).toBe("nightly-refinement");
  expect(second.id).toBe("nightly-refinement-2");
  const updated = await triggers.update(harness, anchor, first.id, { baseRevision: 1, schedule: { ...nightly.schedule, at: "04:00" } }, context);
  expect(updated.generation).toBeGreaterThan(first.generation);
  expect(updated.createdBy).toEqual(first.createdBy);
  expect(updated.revision).toBe(2);
  await expect(triggers.update(harness, anchor, first.id, { baseRevision: 1, name: "stale" }, context)).rejects.toThrow("revision is 2");
});

it("keeps attention until explicit acknowledgement, including failed session identity", async () => {
  const clock = shiftedClock("2026-10-12T12:00:00Z");
  const { TriggerFireError } = await import("./triggerFire.js");
  const { harness, anchor, triggers } = await openHost(clock, () => Promise.reject(new TriggerFireError("launch refused", "session", "/work/repo")));
  await triggers.create(harness, anchor, nightly, context);
  await triggers.run(harness, anchor, nightly.id, "one", context);
  const [failed] = await until(harness, fired(1));
  expect(failed?.attention).not.toBeNull();
  expect(failed?.history[0]?.outcome).toEqual({ kind: "failed", error: "launch refused", sessionId: "session", cwd: "/work/repo" });
  const paused = await triggers.pause(harness, nightly.id, context);
  expect(paused.attention).toEqual(failed?.attention);
  const seen = await triggers.acknowledge(harness, nightly.id, context);
  expect(seen.attention).toBeNull();
  expect(seen.revision).toBe(paused.revision + 1);
});

it("finishes a scheduled fire after pause, edit and restart using the original action", async () => {
  const clock = shiftedClock("2026-10-13T02:59:59.950Z");
  const held = recordingFire({ kind: "hold-until-cancelled" });
  const first = await openHost(clock, held.fire);
  clock.set(JUST_BEFORE_THREE);
  await first.triggers.create(first.harness, first.anchor, nightly, context);
  await until(first.harness, (records) => records[0]?.history[0]?.outcome.kind === "running" && held.requests.length === 1);
  const paused = await first.triggers.pause(first.harness, nightly.id, context);
  await first.triggers.update(first.harness, first.anchor, nightly.id, { baseRevision: paused.revision, name: "Edited", action: { ...nightly.action, workflow: "updated-workflow" } }, context);
  await closeHost(first.harness);
  const host = recordingFire({ kind: "start" });
  const second = await openHost(clock, host.fire);
  const [record] = await until(second.harness, fired(1));
  expect(host.requests).toEqual(held.requests);
  expect(record?.history).toHaveLength(1);
  expect(record?.state.kind).toBe("paused");
  expect(record?.name).toBe("Edited");
  expect(record?.action.workflow).toBe("updated-workflow");
});

it.each([
  { missedGraceMinutes: 0, lateMs: 1, outcome: "started" },
  { missedGraceMinutes: 0, lateMs: 30_000, outcome: "started" },
  { missedGraceMinutes: 0, lateMs: 60_000, outcome: "started" },
  { missedGraceMinutes: 0, lateMs: 60_001, outcome: "missed" },
  { missedGraceMinutes: 1, lateMs: 60_001, outcome: "missed" },
  { missedGraceMinutes: 2, lateMs: 120_000, outcome: "started" },
  { missedGraceMinutes: 2, lateMs: 120_001, outcome: "missed" },
])("at $lateMs ms late with $missedGraceMinutes minutes grace, records $outcome", async ({ missedGraceMinutes, lateMs, outcome }) => {
  const occurrence = at("2026-10-13T03:00:00Z");
  let instant = occurrence - 150;
  // A real Durable timer with a configurable wall clock. Freeze its late wake time for exact boundary checks.
  const clock = { now: () => instant, set: (value: string) => { instant = at(value); } };
  const host = recordingFire({ kind: "start" });
  const { harness, anchor, triggers } = await openHost(clock, host.fire);
  await triggers.create(harness, anchor, { ...nightly, missedGraceMinutes }, context);
  instant = occurrence + lateMs;
  const [trigger] = await until(harness, fired(1));
  expect(trigger?.history[0]).toMatchObject({ occurrence, recordedAt: instant, outcome: { kind: outcome } });
  expect(host.requests).toHaveLength(outcome === "started" ? 1 : 0);
  expect(trigger?.state).toEqual({ kind: "active", nextFireAt: at("2026-10-14T03:00:00Z") });
  expect(trigger?.attention === null).toBe(outcome === "started");
});

it.each(["pause", "edit", "delete"])("does not admit a scheduled fire when %s wins before admission", async (operation) => {
  const clock = shiftedClock("2026-10-13T02:59:59.950Z");
  const host = recordingFire({ kind: "start" });
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const first = await openHost(clock, host.fire, async () => { enter(); await held; });
  clock.set(JUST_BEFORE_THREE);
  await first.triggers.create(first.harness, first.anchor, nightly, context);
  await entered;
  if (operation === "pause") await first.triggers.pause(first.harness, nightly.id, context);
  else if (operation === "delete") await first.triggers.remove(first.harness, nightly.id, context);
  else await first.triggers.update(first.harness, first.anchor, nightly.id, { baseRevision: 1, action: { ...nightly.action, workflow: "edited" } }, context);
  release();
  // Wait for the original task to settle through Durable's public task query.
  const deadline = Date.now() + 5000;
  for (;;) {
    const tasks = await first.harness.commit((tx) => tx.scanTasks({}, 100), context);
    if (tasks.items.some((task) => task.kind === "forgerie.trigger" && task.state.status === "terminal")) break;
    if (host.requests.length > 0) break;
    if (Date.now() > deadline) throw new Error("Admission did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(host.requests).toEqual([]);
  const records = await listTriggers(first.harness, context);
  expect(records[0]?.history ?? []).toEqual([]);
});

it("does not resume an interrupted manual fire into a recreated trigger", async () => {
  const clock = shiftedClock("2026-10-12T12:00:00Z");
  const held = recordingFire({ kind: "hold-until-cancelled" });
  const first = await openHost(clock, held.fire);
  await first.triggers.create(first.harness, first.anchor, nightly, context);
  await first.triggers.run(first.harness, first.anchor, nightly.id, "same", context);
  await until(first.harness, () => held.requests.length === 1);
  await first.triggers.remove(first.harness, nightly.id, context);
  await first.triggers.create(first.harness, first.anchor, { ...nightly, name: "Replacement" }, context);
  await closeHost(first.harness);
  const host = recordingFire({ kind: "start" });
  const second = await openHost(clock, host.fire);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(host.requests).toEqual([]);
  expect((await listTriggers(second.harness, context))[0]?.history).toEqual([]);
});

it("writes no stale completion into a replacement trigger", async () => {
  const clock = shiftedClock("2026-10-12T12:00:00Z");
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const first = await openHost(clock, async (request) => { enter(); await held; return { sessionId: "session", cwd: request.action.cwd, runId: "old-run" }; });
  await first.triggers.create(first.harness, first.anchor, nightly, context);
  await first.triggers.run(first.harness, first.anchor, nightly.id, "same", context);
  await entered;
  await first.triggers.remove(first.harness, nightly.id, context);
  await first.triggers.create(first.harness, first.anchor, { ...nightly, name: "Replacement" }, context);
  release();
  const deadline = Date.now() + 5000;
  while ((await first.harness.commit((tx) => tx.scanTasks({ kind: "forgerie.trigger.manual", status: "terminal" }, 100), context)).items.length === 0) {
    if (Date.now() > deadline) throw new Error("Completion did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const [replacement] = await listTriggers(first.harness, context);
  expect(replacement?.history).toEqual([]);
  expect(replacement?.revision).toBe(1);
});


it("accepts both manual runs whose trigger/client tuples formerly collided", async () => {
  const clock = shiftedClock("2026-10-12T12:00:00Z");
  const host = recordingFire({ kind: "start" });
  const { harness, anchor, triggers } = await openHost(clock, host.fire);
  await triggers.create(harness, anchor, { ...nightly, id: "alpha" }, context);
  await triggers.create(harness, anchor, { ...nightly, id: "alpha-run-beta" }, context);
  const first = await triggers.run(harness, anchor, "alpha", "beta-run-gamma", context);
  const second = await triggers.run(harness, anchor, "alpha-run-beta", "gamma", context);
  expect(first.requestId).not.toBe(second.requestId);
  await until(harness, (records) => records.every((record) => record.history[0]?.outcome.kind === "started"));
  expect(host.requests).toHaveLength(2);
});

it("separates recreated manual runs even at an identical request time", async () => {
  const instant = at("2026-10-12T12:00:00Z");
  const clock = { now: () => instant, set: () => undefined };
  const host = recordingFire({ kind: "start" });
  const { harness, anchor, triggers } = await openHost(clock, host.fire);
  await triggers.create(harness, anchor, nightly, context);
  const first = await triggers.run(harness, anchor, nightly.id, "same", context);
  await until(harness, fired(1));
  await triggers.remove(harness, nightly.id, context);
  await triggers.create(harness, anchor, nightly, context);
  const second = await triggers.run(harness, anchor, nightly.id, "same", context);
  expect(second.requestId).not.toBe(first.requestId);
  await until(harness, fired(1));
  expect(host.requests).toHaveLength(2);
});


it.each(["pause", "edit"])("finishes an admitted scheduled fire after history trimming, %s, and restart", async (change) => {
  const clock = shiftedClock("2026-10-13T02:59:59.950Z");
  const held = recordingFire({ kind: "hold-until-cancelled" });
  const manual = recordingFire({ kind: "start" });
  const scheduledRequestId = `trigger-nightly-${String(at("2026-10-13T03:00:00Z"))}`;
  const first = await openHost(clock, (request, signal) => request.requestId === scheduledRequestId ? held.fire(request, signal) : manual.fire(request, signal));
  clock.set(JUST_BEFORE_THREE);
  await first.triggers.create(first.harness, first.anchor, nightly, context);
  await until(first.harness, () => held.requests.length === 1);
  const original = (await first.harness.commit((tx) => tx.scanTasks({ kind: "forgerie.trigger" }, 100), context)).items[0];
  if (original === undefined) throw new Error("Scheduled task missing");
  if (change === "pause") await first.triggers.pause(first.harness, nightly.id, context);
  else {
    const [record] = await listTriggers(first.harness, context);
    await first.triggers.update(first.harness, first.anchor, nightly.id, { baseRevision: record?.revision, name: "Edited", action: { ...nightly.action, workflow: "edited" } }, context);
  }
  for (let index = 0; index < 50; index++) {
    const accepted = await first.triggers.run(first.harness, first.anchor, nightly.id, `trim-${String(index)}`, context);
    await until(first.harness, (records) => records[0]?.history[0]?.requestId === accepted.requestId && records[0].history[0].outcome.kind === "started");
  }
  const [beforeCrash] = await listTriggers(first.harness, context);
  expect(beforeCrash?.history).toHaveLength(50);
  expect(beforeCrash?.history.some((entry) => entry.requestId === scheduledRequestId)).toBe(false);
  await closeHost(first.harness);

  const started = recordingFire({ kind: "start" });
  const second = await openHost(clock, started.fire);
  await vi.waitFor(async () => {
    const task = await second.harness.commit((tx) => tx.task(original.id), context);
    expect(task?.state.status).toBe("terminal");
  });
  expect(started.requests).toEqual(held.requests);
  const [after] = await listTriggers(second.harness, context);
  expect(after?.history).toHaveLength(50);
  expect(after?.history[0]).toMatchObject({ requestId: scheduledRequestId, cause: "schedule", outcome: { kind: "started" } });
  expect(after?.state).toEqual(beforeCrash?.state);
  expect(after?.revision).toBe((beforeCrash?.revision ?? 0) + 1);
});

/** Seed the immediately preceding persisted protocol through Storage, with no live Harness writing it. */
async function saveAsVersionOne(kind: string): Promise<void> {
  const storage = await openNodeSqliteStorage(join(directory, "triggers.sqlite"));
  try {
    for (const task of (await storage.scanTasks({ kind }, 100, undefined, context)).items) {
      if (task.state.status === "terminal" || task.state.status === "completing") continue;
      const checkpoint = task.state.checkpoint;
      if (checkpoint === null || typeof checkpoint !== "object" || Array.isArray(checkpoint)) throw new Error("Invalid checkpoint fixture");
      const legacy = Object.fromEntries(Object.entries(checkpoint).filter(([key]) => key !== "admitted" && key !== "projects" && (key !== "request" || kind !== "forgerie.trigger.manual")));
      await storage.commit([{ type: "task", value: { ...task, version: 1, state: { status: "pending", checkpoint: legacy } } }], context);
    }
  } finally { await storage.close(context); }
}

it("migrates a version-1 sleeping task and admits its next scheduled occurrence", async () => {
  const clock = shiftedClock("2026-10-12T12:00:00Z");
  const first = await openHost(clock, recordingFire({ kind: "start" }).fire);
  await first.triggers.create(first.harness, first.anchor, nightly, context);
  await closeHost(first.harness);
  await saveAsVersionOne("forgerie.trigger");
  clock.set("2026-10-13T03:00:30Z");
  const started = recordingFire({ kind: "start" });
  const second = await openHost(clock, started.fire);
  await until(second.harness, fired(1));
  expect(started.requests).toHaveLength(1);
  const tasks = await second.harness.commit((tx) => tx.scanTasks({ kind: "forgerie.trigger" }, 100), context);
  expect(tasks.items[0]?.version).toBe(3);
});

it.each(["schedule", "manual"])("migrates a version-1 admitted %s task while paused without recording another start", async (cause) => {
  const clock = shiftedClock(cause === "schedule" ? "2026-10-13T02:59:59.950Z" : "2026-10-12T12:00:00Z");
  const held = recordingFire({ kind: "hold-until-cancelled" });
  const first = await openHost(clock, held.fire);
  if (cause === "schedule") clock.set(JUST_BEFORE_THREE);
  await first.triggers.create(first.harness, first.anchor, nightly, context);
  if (cause === "manual") await first.triggers.run(first.harness, first.anchor, nightly.id, "migrate", context);
  await until(first.harness, () => held.requests.length === 1);
  const paused = await first.triggers.pause(first.harness, nightly.id, context);
  await closeHost(first.harness);
  const kind = cause === "schedule" ? "forgerie.trigger" : "forgerie.trigger.manual";
  await saveAsVersionOne(kind);
  const started = recordingFire({ kind: "start" });
  const second = await openHost(clock, started.fire);
  const [finished] = await until(second.harness, fired(1));
  expect(started.requests).toEqual(held.requests);
  expect(finished?.history).toHaveLength(1);
  expect(finished?.state.kind).toBe("paused");
  expect(finished?.revision).toBe(paused.revision + 2);
  const tasks = await second.harness.commit((tx) => tx.scanTasks({ kind }, 100), context);
  expect(tasks.items[0]?.version).toBe(3);
});

it("fails closed with attention when version-1 admission evidence was already lost", async () => {
  const clock = shiftedClock("2026-10-13T02:59:59.950Z");
  const held = recordingFire({ kind: "hold-until-cancelled" });
  const manual = recordingFire({ kind: "start" });
  const requestId = `trigger-nightly-${String(at("2026-10-13T03:00:00Z"))}`;
  const first = await openHost(clock, (request, signal) => request.requestId === requestId ? held.fire(request, signal) : manual.fire(request, signal));
  clock.set(JUST_BEFORE_THREE);
  await first.triggers.create(first.harness, first.anchor, nightly, context);
  await until(first.harness, () => held.requests.length === 1);
  await first.triggers.pause(first.harness, nightly.id, context);
  for (let index = 0; index < 50; index++) {
    const accepted = await first.triggers.run(first.harness, first.anchor, nightly.id, `legacy-${String(index)}`, context);
    await until(first.harness, (records) => records[0]?.history[0]?.requestId === accepted.requestId && records[0].history[0].outcome.kind === "started");
  }
  await closeHost(first.harness);
  await saveAsVersionOne("forgerie.trigger");
  const started = recordingFire({ kind: "start" });
  const second = await openHost(clock, started.fire);
  const [failed] = await until(second.harness, (records) => records[0]?.history[0]?.outcome.kind === "failed");
  expect(started.requests).toEqual([]);
  expect(failed?.history[0]).toMatchObject({ requestId, outcome: { kind: "failed" } });
  expect(JSON.stringify(failed?.history[0])).toContain("Use Run now to retry");
  expect(failed?.attention).not.toBeNull();
  expect(failed?.state.kind).toBe("paused");
});


it("commits the task admission receipt and running history entry atomically", async () => {
  const clock = shiftedClock("2026-10-13T02:59:59.950Z");
  const host = recordingFire({ kind: "start" });
  const { harness, anchor, triggers } = await openHost(clock, host.fire);
  const witnessed: boolean[] = [];
  const admissionSchema = Type.Object({ phase: Type.Literal("fire"), admitted: Type.Literal(true), projects: Type.Array(Type.Object({ outcome: Type.Object({ kind: Type.Literal("running") }) })) });
  const historySchema = Type.Object({ records: Type.Record(Type.String(), Type.Object({ history: Type.Array(TriggerFireSchema) })) });
  const unsubscribe = harness.subscribeCommits((publication) => {
    const admitted = publication.changes.some((change) => change.type === "task" && change.value.kind === "forgerie.trigger"
      && change.value.state.status !== "terminal" && change.value.state.status !== "completing" && Check(admissionSchema, change.value.state.checkpoint));
    if (!admitted) return;
    const document = publication.changes.find((change) => change.type === "document" && change.record.kind === "forgerie.triggers");
    witnessed.push(document?.type === "document" && Check(historySchema, document.value)
      && document.value.records[nightly.id]?.history[0]?.outcome.kind === "running");
  });
  try {
    clock.set(JUST_BEFORE_THREE);
    await triggers.create(harness, anchor, nightly, context);
    await until(harness, fired(1));
    expect(witnessed).toEqual([true]);
  } finally { unsubscribe(); }
});

it("migrates a one-cwd document and old history without re-arming its sleeping task", async () => {
  const clock = shiftedClock("2026-10-12T12:00:00Z");
  const host = recordingFire({ kind: "start" });
  const first = await openHost(clock, host.fire);
  const record = await first.triggers.create(first.harness, first.anchor, nightly, context);
  await first.triggers.run(first.harness, first.anchor, nightly.id, "legacy-history", context);
  await until(first.harness, fired(1));
  const before = (await first.harness.commit((tx) => tx.scanTasks({ kind: "forgerie.trigger" }, 100), context)).items[0];
  await closeHost(first.harness);
  await saveAsLegacyDocument();
  const second = await openHost(clock, host.fire);
  const [migrated] = await listTriggers(second.harness, context);
  expect(migrated?.action).toMatchObject({ targets: { kind: "projects", cwds: ["/work/repo"] } });
  expect(migrated?.action).not.toHaveProperty("cwd");
  expect(migrated?.history[0]?.projects).toMatchObject([{ cwd: "/work/repo", outcome: { kind: "started" } }]);
  expect(migrated?.generation).toBe(record.generation);
  const after = (await second.harness.commit((tx) => tx.scanTasks({ kind: "forgerie.trigger" }, 100), context)).items[0];
  expect(after?.id).toBe(before?.id); expect(after?.input).toEqual(before?.input);
  expect(host.requests).toHaveLength(1);
});

async function saveAsLegacyDocument(): Promise<void> {
  const storage = await openNodeSqliteStorage(join(directory, "triggers.sqlite"));
  try {
    const [record] = (await storage.scanDocuments({ scope: { kind: "session" }, at: "current", kind: "forgerie.triggers" }, 100, undefined, context)).items;
    if (record === undefined) throw new Error("No trigger document");
    const stored = await storage.document(record.id, "current", context);
    if (stored === undefined) throw new Error("No trigger value");
    const value = structuredClone(stored.value);
    const schema = Type.Object({ records: Type.Record(Type.String(), Type.Object({ action: Type.Object({ targets: Type.Object({ kind: Type.Literal("projects"), cwds: Type.Array(Type.String()) }) }), history: Type.Array(Type.Object({ projects: Type.Array(Type.Unknown()) })) })) });
    if (Check(schema, value)) for (const trigger of Object.values(value.records)) {
      Object.assign(trigger.action, { cwd: trigger.action.targets.cwds[0] }); Reflect.deleteProperty(trigger.action, "targets");
      for (const fire of trigger.history) Reflect.deleteProperty(fire, "projects");
    }
    await storage.commit([{ type: "document.change", id: record.id, content: { version: 1, kind: "base", value } }], context);
  } finally { await storage.close(context); }
}

it("retains settled project receipts and the All projects snapshot across restart", async () => {
  const clock = shiftedClock("2026-10-12T12:00:00Z");
  let registered = ["/work/one", "/work/two"];
  const held = recordingFire({ kind: "hold-until-cancelled" });
  const first = await openHost(clock, (request, signal) => request.action.cwd === "/work/one"
    ? Promise.resolve({ cwd: request.action.cwd, sessionId: "first-session", runId: "first-run" })
    : held.fire(request, signal), undefined, { resolveProjects: () => Promise.resolve(registered) });
  await first.triggers.create(first.harness, first.anchor, { ...nightly, action: { ...nightly.action, targets: { kind: "all" } } }, context);
  await first.triggers.run(first.harness, first.anchor, nightly.id, "partial-restart", context);
  await until(first.harness, (records) => records[0]?.history[0]?.projects[0]?.outcome.kind === "started");
  const before = (await listTriggers(first.harness, context))[0];
  expect(before?.history[0]?.outcome.kind).toBe("running");
  await closeHost(first.harness);
  registered = [...registered, "/work/three"];
  const started = recordingFire({ kind: "start" });
  const second = await openHost(clock, started.fire, undefined, { resolveProjects: () => Promise.resolve(registered) });
  const [finished] = await until(second.harness, fired(1));
  expect(started.requests.map((request) => request.action.cwd)).toEqual(["/work/two"]);
  expect(finished?.history[0]?.projects).toMatchObject([{ cwd: "/work/one", outcome: { kind: "started", sessionId: "first-session", runId: "first-run" } }, { cwd: "/work/two", outcome: { kind: "started" } }]);
});

it.each(["started", "failed"])("acknowledges only the failures already recorded while a sibling ends as %s", async (sibling) => {
  const clock = shiftedClock("2026-10-12T12:00:00Z");
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  const first = await openHost(clock, async (request) => {
    if (request.action.cwd === "/work/one") throw new Error("quota");
    await held;
    if (sibling === "failed") throw new Error("second failure");
    return { cwd: request.action.cwd, sessionId: "other", runId: "other-run" };
  });
  await first.triggers.create(first.harness, first.anchor, { ...nightly, action: { ...nightly.action, targets: { kind: "projects", cwds: ["/work/one", "/work/two"] } } }, context);
  await first.triggers.run(first.harness, first.anchor, nightly.id, "ack-partial", context);
  await until(first.harness, (records) => records[0]?.attention !== null && records[0]?.history[0]?.projects[0]?.outcome.kind === "failed");
  expect((await listTriggers(first.harness, context))[0]?.history[0]?.outcome.kind).toBe("running");
  await first.triggers.acknowledge(first.harness, nightly.id, context);
  release();
  const [finished] = await until(first.harness, fired(1));
  expect(finished?.history[0]?.outcome.kind).toBe("failed");
  expect(finished?.attention === null).toBe(sibling === "started");
});

it("timestamps overlapping fire failures separately across acknowledgement", async () => {
  const start = at("2026-10-12T12:00:00Z");
  let instant = start;
  const clock = { now: () => instant, set: (value: string) => { instant = at(value); } };
  let failA!: () => void; let failB!: () => void;
  const a = new Promise<void>((resolve) => { failA = resolve; });
  const b = new Promise<void>((resolve) => { failB = resolve; });
  const siblings = recordingFire({ kind: "hold-until-cancelled" });
  const host = await openHost(clock, async (request, signal) => {
    if (request.action.cwd === "/work/two") return siblings.fire(request, signal);
    await (request.occurrence === start ? b : a);
    throw new Error(request.occurrence === start ? "B failed" : "A failed");
  });
  try {
    await host.triggers.create(host.harness, host.anchor, { ...nightly, action: { ...nightly.action, targets: { kind: "projects", cwds: ["/work/one", "/work/two"] } } }, context);
    const fireB = await host.triggers.run(host.harness, host.anchor, nightly.id, "B", context);
    await until(host.harness, (records) => records[0]?.history.some((fire) => fire.requestId === fireB.requestId) === true);
    instant = start + 1000;
    const fireA = await host.triggers.run(host.harness, host.anchor, nightly.id, "A", context);
    await until(host.harness, (records) => records[0]?.history.some((fire) => fire.requestId === fireA.requestId) === true);
    instant = start + 2000; failA();
    const [firstFailure] = await until(host.harness, (records) => records[0]?.attention !== null && records[0]?.history.find((fire) => fire.requestId === fireA.requestId)?.projects[0]?.outcome.kind === "failed");
    const oldFailure = firstFailure?.history.find((fire) => fire.requestId === fireA.requestId)?.projects[0]?.outcome;
    if (oldFailure?.kind !== "failed") throw new Error("A failure is missing");
    expect(oldFailure.failedAt).toBe(start + 2000);
    expect(firstFailure?.attention?.since).toBe(oldFailure.failedAt);
    instant = start + 3000;
    await host.triggers.acknowledge(host.harness, nightly.id, context);
    instant = start + 4000; failB();
    const [laterFailure] = await until(host.harness, (records) => records[0]?.attention?.since === start + 4000);
    const newFailure = laterFailure?.history.find((fire) => fire.requestId === fireB.requestId)?.projects[0]?.outcome;
    if (newFailure?.kind !== "failed") throw new Error("B failure is missing");
    expect(newFailure.failedAt).toBe(laterFailure?.attention?.since);
    expect(oldFailure.failedAt).toBeLessThan(newFailure.failedAt ?? 0);
    expect(laterFailure?.history.find((fire) => fire.requestId === fireA.requestId)?.projects[0]?.outcome).toEqual(oldFailure);
    expect(laterFailure?.history.every((fire) => fire.outcome.kind === "running")).toBe(true);
    expect(laterFailure?.history.flatMap((fire) => fire.projects.filter((project) => project.outcome.kind === "failed" && (project.outcome.failedAt ?? 0) >= (laterFailure.attention?.since ?? Infinity)).map(() => fire.requestId))).toEqual([fireB.requestId]);
    await closeHost(host.harness);
    const started = recordingFire({ kind: "start" });
    const recovered = await openHost(clock, started.fire);
    const [finished] = await until(recovered.harness, (records) => records[0]?.history.length === 2 && records[0].history.every((fire) => fire.outcome.kind === "failed"));
    expect(started.requests).toHaveLength(2);
    expect(finished?.history.find((fire) => fire.requestId === fireA.requestId)?.projects[0]?.outcome).toEqual(oldFailure);
    expect(finished?.history.find((fire) => fire.requestId === fireB.requestId)?.projects[0]?.outcome).toEqual(newFailure);
    expect(finished?.attention?.since).toBe(start + 4000);
  } finally { failA(); failB(); }
});


it("records a missed project timestamp on the same clock as attention", async () => {
  const clock = shiftedClock("2026-10-12T12:00:00Z");
  const first = await openHost(clock, recordingFire({ kind: "start" }).fire);
  await first.triggers.create(first.harness, first.anchor, { ...nightly, missedGraceMinutes: 0 }, context);
  await closeHost(first.harness);
  clock.set("2026-10-13T04:00:00Z");
  const recovered = await openHost(clock, recordingFire({ kind: "start" }).fire);
  const [record] = await until(recovered.harness, fired(1));
  const fire = record?.history[0];
  expect(fire?.outcome.kind).toBe("missed");
  const outcome = fire?.projects[0]?.outcome;
  if (outcome?.kind !== "missed") throw new Error("Missed project is missing");
  expect(outcome.missedAt).toBe(fire?.recordedAt);
  expect(outcome.missedAt).toBe(record?.attention?.since);
});
