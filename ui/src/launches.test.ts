import { describe, expect, it } from "vitest";
import { createLaunchStore, launchTitle, type StartupListener } from "./launches";
import type { WorktreeRecord } from "./worktrees/worktreeApi";
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
    expect(calls[0]![3]).toMatchObject({ startupToken: id });
    // Once Pi creates it, the session id is known, so the list can show Pi's row instead of the placeholder.
    calls[0]![3]!.onCreated!({ id: "s1", cwd: "/w" });
    expect(store.getSnapshot()[0]!.state).toEqual({ type: "starting", sessionId: "s1" });
    expect(store.getSnapshot()).toMatchObject([{ id, cwd: "/w", title: "Fix the build", startedAt: "2026-10-05T12:00:00.000Z", state: { type: "starting", sessionId: "s1" }, draft: "draft" }]);
    emit({ startupToken: id, activity: { phase: "active", label: "Refreshing provider models" } });
    emit({ startupToken: "someone-else", activity: { phase: "active", label: "Other" } });
    expect(store.getSnapshot()[0]!.state).toEqual({ type: "starting", sessionId: "s1", progress: "Refreshing provider models" });
    // The detail names the step; the label only repeats that a session is being created.
    emit({ startupToken: id, activity: { phase: "active", label: "Creating session", detail: "Loading session extensions" } });
    expect(store.getSnapshot()[0]!.state).toEqual({ type: "starting", sessionId: "s1", progress: "Loading session extensions" });
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

describe("failed setup recovery outside the dialog", () => {
  const failed: WorktreeRecord = { id: "wt1", repo: "/repo", path: "/repo/.worktree/task", branch: "task", defaultBranch: "main",
    setup: { phase: "failed", exitCode: 7, log: "Dependency install failed" }, state: { kind: "active" }, cleanup: { kind: "pending" } };

  it("retries the same setup with the original prompt, files, model, thinking and backlog item", async () => {
    const calls: Parameters<Start>[] = [];
    const store = createLaunchStore<string>({ start: async (...args) => { calls.push(args);
      return { type: "failed", failure: { stage: "start", message: "Setup failed", maybeStarted: true } };
    } });
    const prompt = { text: "Fix it", files: [{ kind: "file" as const, name: "notes.txt", mimeType: "text/plain", data: "bm90ZXM=" }] };
    const choice = { model: { provider: "p", id: "opus" }, thinkingLevel: "high" };
    const first = store.launch("/repo", prompt, choice, "original draft", {
      destination: { kind: "fresh-worktree" }, item: { projectId: "p1", itemId: "a" }, worktree: failed,
    });
    await first.done;
    const retry = store.retrySetup(first.id)!;
    await retry.done;
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject(["/repo", prompt, choice, { setupId: "wt1", destination: { kind: "fresh-worktree" }, item: { projectId: "p1", itemId: "a" } }]);
    expect(store.getSnapshot()).toMatchObject([{ id: retry.id, draft: "original draft", state: { type: "failed", maybeStarted: false } }]);
  });

  it("recovers inventory once and drops discarded setup identity without losing its draft", () => {
    const store = createLaunchStore<string>({ start: async () => ({ type: "started", session: { id: "s1", cwd: "/repo" } }) }, { setupDraft: () => "recovered" });
    store.recoverSetup(failed); store.recoverSetup(failed);
    expect(store.getSnapshot()).toHaveLength(1);
    const launch = store.getSnapshot()[0]!;
    expect(launch.state).toMatchObject({ type: "failed", error: expect.stringContaining("exited with 7") });
    store.forgetSetup(launch.id);
    expect(store.getSnapshot()[0]).toMatchObject({ draft: "recovered", worktree: undefined, placement: { setupId: undefined } });
    expect(store.retrySetup(launch.id)).toBeUndefined();
  });
});
