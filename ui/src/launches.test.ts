import { describe, expect, it } from "vitest";
import { createLaunchStore, launchTitle, type StartupListener } from "./launches";
import type { NewSessionApi } from "./newSession";

type Start = NewSessionApi["start"];
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function harness() {
  const calls: Parameters<Start>[] = [];
  const replies: ReturnType<typeof gate<Awaited<ReturnType<Start>>>>[] = [];
  const start: Start = (...args) => { calls.push(args); const reply = gate<Awaited<ReturnType<Start>>>(); replies.push(reply); return reply.promise; };
  let emit: StartupListener = () => {};
  const store = createLaunchStore<string>({ start }, { onStartup: (listener) => { emit = listener; return () => {}; },
    now: () => new Date("2026-10-05T12:00:00Z") });
  return { store, calls, replies, emit: (...args: Parameters<StartupListener>) => emit(...args) };
}

describe("launches", () => {
  it("names a start by its first line", () => {
    expect(launchTitle("\n  Fix the login form  \nwith tests")).toBe("Fix the login form");
    expect(launchTitle("")).toBe("New session");
    expect(launchTitle("x".repeat(100))).toHaveLength(80);
  });

  it("labels each start, follows its progress, and records how it ended", async () => {
    const { store, calls, replies, emit } = harness();
    const { id, done } = store.launch("/w", { text: "Fix the build" }, {}, "draft");
    expect(calls[0]![3]).toEqual({ startupToken: id });
    expect(store.getSnapshot()).toEqual([{ id, cwd: "/w", title: "Fix the build", startedAt: "2026-10-05T12:00:00.000Z", state: { type: "starting" }, draft: "draft" }]);
    emit({ startupToken: id, activity: { phase: "active", label: "Refreshing provider models" } });
    emit({ startupToken: "someone-else", activity: { phase: "active", label: "Other" } });
    expect(store.getSnapshot()[0]!.state).toEqual({ type: "starting", progress: "Refreshing provider models" });
    replies[0]!.resolve({ type: "started", session: { id: "s1", cwd: "/w" } });
    expect(await done).toEqual({ type: "started", session: { id: "s1", cwd: "/w" } });
    expect(store.getSnapshot()[0]!.state).toEqual({ type: "started", session: { id: "s1", cwd: "/w" } });
  });

  it("keeps a failure with its draft until the draft is taken back", async () => {
    const { store, replies } = harness();
    const { id, done } = store.launch("/w", { text: "hi" }, {}, "my draft");
    replies[0]!.resolve({ type: "failed", failure: { stage: "start", message: "Pi is down.", maybeStarted: true } });
    expect(await done).toMatchObject({ type: "failed", maybeStarted: true, error: expect.stringContaining("may have started anyway") });
    expect(store.take(id)?.draft).toBe("my draft");
    expect(store.getSnapshot()).toEqual([]);
  });

  it("says which session exists when only the first message failed", async () => {
    const { store, replies } = harness();
    const { done } = store.launch("/w", { text: "hi" }, {}, "");
    replies[0]!.resolve({ type: "failed", failure: { stage: "prompt", session: { id: "s2", cwd: "/w" }, message: "Lost." } });
    expect(await done).toMatchObject({ type: "unsent", session: { id: "s2" } });
  });

  it("will not dismiss a start that is still running", () => {
    const { store } = harness();
    const { id } = store.launch("/w", { text: "hi" }, {}, "");
    store.dismiss(id);
    expect(store.getSnapshot()).toHaveLength(1);
  });
});
