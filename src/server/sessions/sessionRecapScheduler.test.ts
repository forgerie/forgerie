import { afterEach, describe, expect, it, vi } from "vitest";
import { RECAP_AWAY_MS, type RecapResult } from "../../shared/sessionRecap.js";
import { canWriteRecap, SessionRecapScheduler, type RecapGuards } from "./sessionRecapScheduler.js";
const eligible: RecapGuards = { enabled: true, idle: true, writable: true, child: false, completedTurns: 3,
  unseenTurns: 2, longestUnseenReply: 0, lastSeenAt: 0, now: RECAP_AWAY_MS, covered: false, hasExchange: true };
const ref = { id: "session", cwd: "/repo" };
afterEach(() => { vi.useRealTimers(); });
describe("arrival recap eligibility", () => {
  it("requires thirty minutes away, inclusively, and treats never seen as away", () => {
    expect(canWriteRecap(eligible, "open")).toBe(true);
    expect(canWriteRecap({ ...eligible, now: RECAP_AWAY_MS - 1 }, "open")).toBe(false);
    expect(canWriteRecap({ ...eligible, lastSeenAt: undefined, now: 0 }, "open")).toBe(true);
    expect(canWriteRecap({ ...eligible, lastSeenAt: RECAP_AWAY_MS + 1 }, "open")).toBe(false);
  });
  it("requires two unseen completed turns or one long visible reply", () => {
    expect(canWriteRecap({ ...eligible, unseenTurns: 1, longestUnseenReply: 1999 }, "open")).toBe(false);
    expect(canWriteRecap({ ...eligible, unseenTurns: 1, longestUnseenReply: 2000 }, "open")).toBe(true);
    expect(canWriteRecap({ ...eligible, unseenTurns: 0, longestUnseenReply: 2000 }, "open")).toBe(true);
  });
  it("keeps idle, writable parent, coverage, config and total-turn guards; legacy automatic never writes", () => {
    for (const patch of [{ enabled: false }, { idle: false }, { writable: false }, { child: true },
      { completedTurns: 2 }, { covered: true }, { hasExchange: false }]) {
      expect(canWriteRecap({ ...eligible, ...patch }, "open")).toBe(false);
    }
    expect(canWriteRecap(eligible, "automatic")).toBe(false);
    expect(canWriteRecap({ ...eligible, completedTurns: 0, unseenTurns: 0, enabled: false, covered: true, now: 0 }, "manual")).toBe(true);
    for (const patch of [{ idle: false }, { writable: false }, { child: true }, { hasExchange: false }]) {
      expect(canWriteRecap({ ...eligible, ...patch }, "manual")).toBe(false);
    }
  });
});
describe("recap request ownership", () => {
  it("never generates on elapsed time alone", async () => {
    vi.useFakeTimers();
    const generate = vi.fn((): Promise<RecapResult> => Promise.resolve({ kind: "written" }));
    const scheduler = new SessionRecapScheduler(generate);
    await vi.advanceTimersByTimeAsync(RECAP_AWAY_MS * 10);
    expect(generate).not.toHaveBeenCalled(); scheduler.dispose();
  });
  it("shares in-flight work and aborts on new input", async () => {
    const generate = vi.fn((_ref, _trigger, signal: AbortSignal) => new Promise<RecapResult>(resolve => {
      signal.addEventListener("abort", () => { resolve({ kind: "failed", message: "cancelled" }); });
    }));
    const scheduler = new SessionRecapScheduler(generate);
    const first = scheduler.request(ref, "open"), second = scheduler.request(ref, "manual");
    expect(first).toBe(second); await Promise.resolve();
    scheduler.cancel(ref, true); expect(await first).toEqual({ kind: "skipped" }); scheduler.dispose();
  });
  it("stopping cancels every cwd for that session, leaving other sessions alone", async () => {
    const signals: AbortSignal[] = [];
    const scheduler = new SessionRecapScheduler((_target, _trigger, signal) => new Promise<RecapResult>(resolve => {
      signals.push(signal); signal.addEventListener("abort", () => { resolve({ kind: "written" }); });
    }));
    const pending = [scheduler.request(ref, "open"), scheduler.request({ ...ref, cwd: "/other" }, "open"), scheduler.request({ ...ref, id: "neighbour" }, "manual")];
    await Promise.resolve(); scheduler.cancelSession(ref.id);
    expect(signals.map(signal => signal.aborted)).toEqual([true, true, false]);
    scheduler.dispose(); expect(await Promise.all(pending)).toEqual(Array(3).fill({ kind: "skipped" }));
    expect(await scheduler.request(ref, "manual")).toEqual({ kind: "skipped" });
  });
  it("contains failures without automatic retry", async () => {
    vi.useFakeTimers();
    const generate = vi.fn(() => Promise.reject(new Error("generation failed")));
    const scheduler = new SessionRecapScheduler(generate);
    expect(await scheduler.request(ref, "open")).toMatchObject({ kind: "failed" });
    await vi.advanceTimersByTimeAsync(RECAP_AWAY_MS); expect(generate).toHaveBeenCalledOnce(); scheduler.dispose();
  });
});

it("uses the pre-arrival snapshot even when a heartbeat lands before the recap request", async () => {
  const { SessionUnreadStore } = await import("./sessionUnreadStore.js");
  let now = 0;
  const store = new SessionUnreadStore({ now: () => new Date(now) });
  store.observeSeen(ref.id, ref.cwd, "old", ["old"]);
  now = RECAP_AWAY_MS;
  const scheduler = new SessionRecapScheduler(() => Promise.resolve({ kind: "written" }));
  const arrivalId = scheduler.arrive(ref, { seen: store.seenState(ref.id, ref.cwd), at: now });
  store.observeSeen(ref.id, ref.cwd, "latest", ["old", "latest"]);
  const arrival = scheduler.takeArrival(ref, arrivalId, now);
  expect(arrival?.seen).toEqual({ lastSeenAt: 0, seenThrough: "old" });
  expect(canWriteRecap({ ...eligible, lastSeenAt: arrival?.seen?.lastSeenAt }, "open")).toBe(true);
  expect(canWriteRecap({ ...eligible, lastSeenAt: store.seenState(ref.id, ref.cwd)?.lastSeenAt }, "open")).toBe(false);
  expect(scheduler.takeArrival(ref, arrivalId, now)).toBeUndefined();
  const other = scheduler.arrive(ref, { seen: undefined, at: now });
  expect(scheduler.takeArrival({ ...ref, cwd: "/foreign" }, other, now)).toBeUndefined();
  expect(scheduler.takeArrival(ref, other, now + 120_001)).toBeUndefined();
  scheduler.dispose();
});
