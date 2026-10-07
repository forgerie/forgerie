import { describe, expect, it } from "vitest";
import { createLaunchStore, type WorktreeListener } from "../launches";
import type { NewSessionApi } from "../newSession";
import { applyCatalogEvent, type CatalogState } from "../picker/catalogStore";
import { createRowActions } from "../picker/rowActions";
import type { WorktreeRecord } from "./worktreeApi";

type Start = NewSessionApi["start"];
const record = (extra: Partial<WorktreeRecord> = {}): WorktreeRecord => ({
  id: "wt1", repo: "/r", path: "/r/.worktree/s-1", branch: "s-1", defaultBranch: "main", setup: { phase: "creating", log: "" },
  state: { kind: "active" }, cleanup: { kind: "pending" }, ...extra,
});

function harness(findWorktree?: (token: string) => WorktreeRecord | undefined) {
  const calls: Parameters<Start>[] = [];
  let reply!: (value: Awaited<ReturnType<Start>>) => void;
  const start: Start = (...args) => { calls.push(args); return new Promise((done) => { reply = done; }); };
  let emit: WorktreeListener = () => {};
  const store = createLaunchStore<string>({ start }, {
    onWorktree: (listener) => { emit = listener; return () => {}; },
    findWorktree: findWorktree && (async (token) => findWorktree(token)),
  });
  return { store, calls, reply: (value: Awaited<ReturnType<Start>>) => reply(value), emit: (value: WorktreeRecord) => emit(value) };
}

describe("a start in a fresh worktree", () => {
  it("sends the destination and follows the setup by its startup token", async () => {
    const { store, calls, emit, reply } = harness();
    const { id, done } = store.launch("/r", { text: "Fix it" }, {}, "draft", { destination: { kind: "fresh-worktree" } });
    expect(calls[0]![3]).toMatchObject({ startupToken: id, destination: { kind: "fresh-worktree" } });
    expect(store.getSnapshot()[0]!.state).toEqual({ type: "starting", progress: "Creating worktree…" });
    emit(record({ startupToken: id, setup: { phase: "hook", log: "installing" } }));
    emit(record({ id: "wt-other", startupToken: "other", setup: { phase: "failed", log: "" } }));
    expect(store.getSnapshot()[0]).toMatchObject({ hookSeen: true, state: { progress: "Running worktree-post-create…" }, worktree: { setup: { phase: "hook" } } });
    emit(record({ startupToken: id, setup: { phase: "starting", log: "installing\ndone" } }));
    expect(store.getSnapshot()[0]!.state).toMatchObject({ progress: "Starting Pi…" });
    reply({ type: "started", session: { id: "s1", cwd: "/r/.worktree/s-1" } });
    expect(await done).toEqual({ type: "started", session: { id: "s1", cwd: "/r/.worktree/s-1" } });
  });

  it("reports a failed setup as certain: Pi never started, and the worktree can be retried", async () => {
    const { store, emit, reply } = harness();
    const launch = store.launch("/r", { text: "Fix it" }, {}, "draft", { destination: { kind: "fresh-worktree" } });
    emit(record({ startupToken: launch.id, setup: { phase: "failed", log: "npm ERR!", exitCode: 1, error: "Post-create hook exited with 1" } }));
    reply({ type: "failed", failure: { stage: "start", message: "Post-create hook exited with 1", maybeStarted: true } });
    expect(await launch.done).toEqual({ type: "failed", error: "Worktree setup failed: worktree-post-create exited with 1.", maybeStarted: false });
    expect(launch.worktree()?.setup.exitCode).toBe(1);
  });

  it("reads the inventory when the failure's events did not arrive", async () => {
    const { store, reply } = harness((token) => record({ startupToken: token, setup: { phase: "failed", log: "", error: "fatal: bad ref" } }));
    const launch = store.launch("/r", { text: "x" }, {}, "draft", { destination: { kind: "fresh-worktree" } });
    reply({ type: "failed", failure: { stage: "start", message: "fatal: bad ref", maybeStarted: true } });
    expect(await launch.done).toMatchObject({ type: "failed", maybeStarted: false, error: "Worktree setup failed: fatal: bad ref" });
  });

  it("retries a failed setup by its id, in the same worktree", () => {
    const { store, calls, emit } = harness();
    const failed = record({ id: "wt9", startupToken: "old", setup: { phase: "failed", log: "x", exitCode: 1 } });
    store.launch("/r", { text: "x" }, {}, "d", { destination: { kind: "fresh-worktree" }, setupId: "wt9", worktree: failed });
    expect(calls[0]![3]).toMatchObject({ setupId: "wt9" });
    // The retry's events keep the old record's token, so the record id matches it.
    emit(record({ id: "wt9", startupToken: "old", setup: { phase: "hook", log: "" } }));
    expect(store.getSnapshot()[0]!.worktree?.setup.phase).toBe("hook");
  });

  it("starts an existing workspace with no worktree progress", () => {
    const { store, calls } = harness();
    store.launch("/r", { text: "x" }, {}, "d", { destination: { kind: "existing-workspace" } });
    expect(calls[0]![3]).toMatchObject({ destination: { kind: "existing-workspace" } });
    expect(store.getSnapshot()[0]!.state).toEqual({ type: "starting" });
  });
});

describe("the catalog's worktrees", () => {
  const base: CatalogState = { connection: { type: "ready" }, statuses: {}, activities: {}, unread: new Set(), projects: [],
    sessions: [{ id: "s1", cwd: "/r/.worktree/s-1", modified: "t" }, { id: "s2", cwd: "/r", modified: "t" }] };

  it("attaches a worktree to its owner and follows Land", () => {
    const once = applyCatalogEvent(base, { type: "session.worktree", worktree: record({ sessionId: "s1", setup: { phase: "done", log: "" } }) });
    expect(once.sessions[0]!.worktree).toMatchObject({ id: "wt1", owned: true, state: { kind: "active" } });
    expect(once.sessions[1]!.worktree).toBeUndefined();
    const landed = applyCatalogEvent(once, { type: "session.worktree", worktree: record({ sessionId: "s1", state: { kind: "landed", sha: "abc", at: "t" } }) });
    expect(landed.sessions[0]!.worktree?.state).toEqual({ kind: "landed", sha: "abc", at: "t" });
  });

  it("ignores a worktree no listed session runs in", () => {
    expect(applyCatalogEvent(base, { type: "session.worktree", worktree: record({ id: "wt-x", sessionId: "s-unknown" }) })).toBe(base);
  });
});

describe("archive notes", () => {
  const writes = { setPinned: async () => {}, setArchived: async () => {}, deleteArchived: async () => {} };
  const timers = { set: () => 0, clear: () => {} };

  it("joins a kept worktree's reason to the archive's undo offer, and keeps it on screen", async () => {
    const actions = createRowActions({ writes, copy: async () => true, timers });
    await actions.archive({ id: "s1", cwd: "/w", name: "Fix" });
    actions.annotate("s1", "Kept worktree fix: 2 commits are not on main");
    expect(actions.getSnapshot().toast).toEqual({ type: "undo", target: { id: "s1", cwd: "/w", name: "Fix" }, note: "Kept worktree fix: 2 commits are not on main" });
  });

  it("shows a note that arrives before the archive's reply", async () => {
    let finish!: () => void;
    const actions = createRowActions({ writes: { ...writes, setArchived: () => new Promise<void>((done) => { finish = done; }) }, copy: async () => true, timers });
    const archived = actions.archive({ id: "s1", cwd: "/w" });
    actions.annotate("s1", "Kept worktree fix: shared");
    finish();
    await archived;
    expect(actions.getSnapshot().toast).toMatchObject({ type: "undo", note: "Kept worktree fix: shared" });
  });

  it("stands alone once the undo offer is gone", () => {
    const actions = createRowActions({ writes, copy: async () => true, timers });
    actions.annotate("s1", "Kept worktree fix: shared");
    expect(actions.getSnapshot().toast).toEqual({ type: "note", text: "Kept worktree fix: shared" });
  });
});
