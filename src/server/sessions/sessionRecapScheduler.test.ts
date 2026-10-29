import { afterEach, describe, expect, it, vi } from "vitest";
import { RECAP_DELAY_MS, type RecapResult } from "../../shared/sessionRecap.js";
import { canWriteRecap, SessionRecapScheduler, type RecapGuards } from "./sessionRecapScheduler.js";
const eligible: RecapGuards = { enabled: true, unread: true, idle: true, writable: true, child: false, completedTurns: 3,
  newTurns: 2, hasRecap: true, covered: false, hasExchange: true };
const ref = { id: "session", cwd: "/repo" };
const summary = { sessionId: ref.id, cwd: ref.cwd, completedAt: new Date(0).toISOString(), completionOrder: 1 };
afterEach(() => { vi.useRealTimers(); });
describe("recap scheduling", () => {
  it("enforces every automatic guard; manual ignores config, unread and turn counts only", () => {
    expect(canWriteRecap(eligible, "automatic")).toBe(true);
    for (const patch of [{ enabled: false }, { unread: false }, { idle: false }, { writable: false }, { child: true },
      { completedTurns: 2 }, { newTurns: 1 }, { covered: true }, { hasExchange: false }]) {
      expect(canWriteRecap({ ...eligible, ...patch }, "automatic")).toBe(false);
      expect(canWriteRecap({ ...eligible, ...patch }, "open")).toBe(false);
    }
    expect(canWriteRecap({ ...eligible, hasRecap: false, newTurns: 0 }, "automatic")).toBe(true);
    expect(canWriteRecap({ ...eligible, completedTurns: 0, newTurns: 0, enabled: false, unread: false, covered: true }, "manual")).toBe(true);
    for (const patch of [{ idle: false }, { writable: false }, { child: true }, { hasExchange: false }]) {
      expect(canWriteRecap({ ...eligible, ...patch }, "manual")).toBe(false);
    }
  });
  it("runs at ten minutes and cancels on acknowledgement", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const generate = vi.fn((): Promise<RecapResult> => Promise.resolve({ kind: "written" }));
    const scheduler = new SessionRecapScheduler(generate);
    scheduler.schedule(summary);
    await vi.advanceTimersByTimeAsync(RECAP_DELAY_MS - 1); expect(generate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(generate).toHaveBeenCalledOnce();
    scheduler.schedule({ ...summary, completionOrder: 2 }); scheduler.cancel(ref);
    await vi.advanceTimersByTimeAsync(RECAP_DELAY_MS); expect(generate).toHaveBeenCalledOnce(); scheduler.dispose();
  });
  it("retries automatic failure once after 30 seconds, not manual or open", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const generate = vi.fn((): Promise<RecapResult> => Promise.resolve({ kind: "failed", message: "bounded" }));
    const scheduler = new SessionRecapScheduler(generate);
    scheduler.schedule(summary);
    await vi.advanceTimersByTimeAsync(RECAP_DELAY_MS); expect(generate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29_999); expect(generate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(generate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RECAP_DELAY_MS); expect(generate).toHaveBeenCalledTimes(2);
    await scheduler.request(ref, "manual"); await scheduler.request(ref, "open");
    await vi.advanceTimersByTimeAsync(RECAP_DELAY_MS); expect(generate).toHaveBeenCalledTimes(4); scheduler.dispose();
  });
  it("shares one in-flight request and cancels it on new input without a retry", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const generate = vi.fn((_ref, _trigger, signal: AbortSignal) => new Promise<RecapResult>(resolve => { signal.addEventListener("abort", () => { resolve({ kind: "failed", message: "cancelled" }); }); }));
    const scheduler = new SessionRecapScheduler(generate);
    const first = scheduler.request(ref, "open"), second = scheduler.request(ref, "manual");
    expect(first).toBe(second); await vi.advanceTimersByTimeAsync(0);
    scheduler.cancel(ref, true); expect(await first).toEqual({ kind: "skipped" });
    await vi.advanceTimersByTimeAsync(RECAP_DELAY_MS); expect(generate).toHaveBeenCalledOnce(); scheduler.dispose();
  });
  it("re-arms past-due catalog entries staggered and bounds concurrency to two", async () => {
    vi.useFakeTimers(); vi.setSystemTime(RECAP_DELAY_MS * 2);
    const resolve: ((result: RecapResult) => void)[] = [];
    const generate = vi.fn(() => new Promise<RecapResult>(done => { resolve.push(done); }));
    const scheduler = new SessionRecapScheduler(generate);
    scheduler.rearm(Array.from({ length: 5 }, (_, index) => ({ ...summary, sessionId: `session-${String(index)}` })));
    await vi.advanceTimersByTimeAsync(0); expect(generate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); expect(generate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000); expect(generate).toHaveBeenCalledTimes(2);
    resolve[0]?.({ kind: "written" }); await vi.advanceTimersByTimeAsync(1000); expect(generate).toHaveBeenCalledTimes(3);
    scheduler.dispose(); for (const done of resolve) done({ kind: "written" });
  });
});

it("does not re-arm an automatic retry after the completion is read during the request", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  let finish!: (result: RecapResult) => void;
  const generate = vi.fn(() => new Promise<RecapResult>(resolve => { finish = resolve; }));
  const scheduler = new SessionRecapScheduler(generate);
  scheduler.schedule(summary);
  await vi.advanceTimersByTimeAsync(RECAP_DELAY_MS);
  scheduler.cancel(ref); finish({ kind: "failed", message: "bounded" });
  await vi.advanceTimersByTimeAsync(RECAP_DELAY_MS);
  expect(generate).toHaveBeenCalledOnce(); scheduler.dispose();
});


it("keeps a future persisted completion scheduled across the platform timer limit", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const generate = vi.fn((): Promise<RecapResult> => Promise.resolve({ kind: "written" }));
  const scheduler = new SessionRecapScheduler(generate);
  const completedAt = new Date(3_000_000_000).toISOString();
  scheduler.rearm([{ ...summary, completedAt }]);
  await vi.advanceTimersByTimeAsync(3_000_000_000 + RECAP_DELAY_MS - 1);
  expect(generate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(generate).toHaveBeenCalledOnce(); scheduler.dispose();
});

it("stopping a session cancels its timers in every cwd and aborts its request, leaving other sessions alone", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const signals: AbortSignal[] = [];
  const generate = vi.fn((target: { id: string }, _trigger: string, signal: AbortSignal) => {
    signals.push(signal);
    return target.id === ref.id && signals.length === 1 ? new Promise<RecapResult>(resolve => { signal.addEventListener("abort", () => { resolve({ kind: "written" }); }); }) : Promise.resolve<RecapResult>({ kind: "written" });
  });
  const scheduler = new SessionRecapScheduler(generate);
  const pending = scheduler.request(ref, "open");
  await vi.advanceTimersByTimeAsync(0);
  scheduler.schedule({ ...summary, cwd: "/other" });
  scheduler.schedule({ ...summary, sessionId: "neighbour" });
  scheduler.cancelSession(ref.id);
  expect(signals[0]?.aborted).toBe(true);
  expect(await pending).toEqual({ kind: "skipped" });
  await vi.advanceTimersByTimeAsync(RECAP_DELAY_MS);
  expect(generate.mock.calls.map(([target]) => target.id)).toEqual([ref.id, "neighbour"]);
  scheduler.dispose();
});
