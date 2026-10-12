import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Trigger } from "../../shared/triggers.js";
import { durableTriggers, listTriggers, TriggerError, type TriggerFireReceipt, type TriggerFireRequest } from "./durableTriggers.js";

const at = (value: string) => Date.parse(value);
const nightly = {
  id: "nightly", name: "Nightly refinement",
  schedule: { kind: "daily", at: "03:00", timezone: "UTC" },
  action: { kind: "workflow", cwd: "/work/repo", workflow: "nightly-refine", inputs: { scope: "yesterday" } },
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
  const requests: TriggerFireRequest[] = [];
  const fire = async (request: TriggerFireRequest, signal: Context): Promise<TriggerFireReceipt> => {
    requests.push(request);
    if (behavior.kind === "fail") throw new Error(behavior.error);
    if (behavior.kind === "hold-until-cancelled") {
      await new Promise<never>((_resolve, reject) => {
        signal.abortSignal?.addEventListener("abort", () => { reject(new Error("cancelled")); }, { once: true });
      });
    }
    return { sessionId: `session-${String(requests.length)}`, runId: `run-${request.requestId}` };
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

async function openHost(clock: ReturnType<typeof shiftedClock>, fire: ReturnType<typeof recordingFire>["fire"]) {
  const triggers = durableTriggers({ fire, now: clock.now });
  const registry = createRegistry();
  registry.install(triggers.extension);
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, "triggers.sqlite")), { models: createModels(), registry, now: clock.now }, context);
  open.push(harness);
  const anchor = (await harness.root(context)).id;
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
const fired = (count: number) => (triggers: Trigger[]) => (triggers[0]?.history.length ?? 0) >= count;

it("fires at the occurrence with a per-occurrence request ID, records it, and arms the next day", async () => {
  const clock = shiftedClock("2026-10-13T02:59:59.950Z");
  const host = recordingFire({ kind: "start" });
  const { harness, anchor, triggers } = await openHost(clock, host.fire);
  clock.set(JUST_BEFORE_THREE);
  const created = await triggers.create(harness, anchor, nightly, context);
  expect(created.state).toEqual({ kind: "active", nextFireAt: at("2026-10-13T03:00:00Z") });

  const [trigger] = await until(harness, fired(1));
  const occurrence = at("2026-10-13T03:00:00Z");
  expect(host.requests).toEqual([{ triggerId: "nightly", name: "Nightly refinement", action: nightly.action, occurrence, requestId: `trigger-nightly-${String(occurrence)}` }]);
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
});
