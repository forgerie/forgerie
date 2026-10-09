import { describe, expect, it } from "vitest";
import { actionResultSchema, createWorktreeApi, mergeRecord, parseWorktreeEvent, worktreeInfoSchema, type WorktreeInfo, type WorktreeRecord, type WorktreeSetup } from "./worktreeApi";
import { archiveNote, discardSummary, outcomeOf, readouts, receiptText, setupSteps, visibleSetup } from "./worktreeModel";
import { combineWorktree } from "./useSessionWorktree";

const setup = (phase: WorktreeSetup["phase"], extra: Partial<WorktreeSetup> = {}): WorktreeSetup => ({ phase, log: "", ...extra });
const record = (extra: Partial<WorktreeRecord> = {}): WorktreeRecord => ({
  id: "wt1", repo: "/r", path: "/r/.worktree/s-1", branch: "s-1", defaultBranch: "main", setup: setup("done"),
  state: { kind: "active" }, cleanup: { kind: "pending" }, ...extra,
});
const info = (extra: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
  id: "wt1", owned: true, repo: "/r", path: "/r/.worktree/s-1", branch: "fix-login", defaultBranch: "main",
  state: { kind: "active" }, setup: setup("done"), cleanup: { kind: "pending" }, ...extra,
});

describe("worktree setup", () => {
  it("shows the hook step only once the server reports it ran", () => {
    expect(setupSteps(setup("creating"), false).map((step) => [step.key, step.state])).toEqual([["create", "running"], ["start", "waiting"]]);
    expect(setupSteps(setup("hook", { log: "added 12 packages" }), true).map((step) => [step.key, step.state]))
      .toEqual([["create", "done"], ["hook", "running"], ["start", "waiting"]]);
    expect(setupSteps(setup("starting"), false).map((step) => step.state)).toEqual(["done", "running"]);
  });

  it("puts a failure on the step that failed, and the hook's exit code on the hook", () => {
    const hook = setupSteps(setup("failed", { exitCode: 2, log: "npm ERR!", error: "Post-create hook exited with 2" }), true);
    expect(hook.map((step) => [step.key, step.state])).toEqual([["create", "done"], ["hook", "failed"], ["start", "waiting"]]);
    expect(setupSteps(setup("failed", { error: "fatal: invalid reference" }), false).map((step) => step.state)).toEqual(["failed", "waiting"]);
  });

  it("hides a clean setup once the turn is live, and keeps a failed or running one", () => {
    expect(visibleSetup(setup("done"), false)?.phase).toBe("done");
    expect(visibleSetup(setup("done"), true)).toBeUndefined();
    expect(visibleSetup(setup("failed"), true)?.phase).toBe("failed");
    expect(visibleSetup(setup("hook"), true)?.phase).toBe("hook");
  });
});

describe("worktree readouts", () => {
  it("reads counts as short marks with a full sentence", () => {
    expect(readouts(info({ ahead: 4, dirtyFiles: 2 }))).toEqual({
      marks: [{ key: "ahead", text: "↑4", label: "4 commits not on main" }, { key: "dirty", text: "±2", label: "2 changed files not committed" }],
      sentence: "4 commits ahead of main, 2 changed files",
    });
    expect(readouts(info({ ahead: 0, dirtyFiles: 0 }))).toEqual({ marks: [], sentence: "No commits ahead of main, clean" });
  });

  it("never reads an unreadable status as clean", () => {
    const result = readouts(info({ statusError: "not a git repository" }));
    expect(result.marks[0]?.key).toBe("error");
    expect(result.sentence).toContain("unavailable");
  });

  it("says what Discard throws away", () => {
    expect(discardSummary({ defaultBranch: "main", dirtyFiles: [], commits: [1, 2, 3, 4].map((n) => ({ sha: `a${String(n)}`, subject: "x" })) }))
      .toMatch(/^4 commits not on main will be lost/u);
    expect(discardSummary({ defaultBranch: "main", commits: [{ sha: "a", subject: "x" }], dirtyFiles: ["a.ts", "b.ts"] }))
      .toMatch(/^1 commit not on main and 2 uncommitted files will be lost/u);
    expect(discardSummary({ defaultBranch: "main", commits: [], dirtyFiles: [] })).toMatch(/^Nothing here is missing from main/u);
  });
});

describe("Land and Discard outcomes", () => {
  it("names the landing sha, and keeps a failed cleanup from undoing the land", () => {
    expect(outcomeOf({ kind: "landed", sha: "0123456789abcdef", cleanup: { kind: "done" } }, "main")).toEqual({ tone: "done", title: "Landed on main at 0123456", detail: undefined });
    const failed = outcomeOf({ kind: "landed", sha: "0123456789", cleanup: { kind: "failed", error: "hook exited 1." } }, "main");
    expect(failed.title).toBe("Landed on main at 0123456");
    expect(failed.tone === "done" && failed.detail).toContain("hook exited 1.");
  });

  it("offers a conflict to the agent with its files", () => {
    expect(outcomeOf({ kind: "conflict", files: ["a.ts"], defaultBranch: "main", prompt: "Resolve a.ts" }, "main"))
      .toEqual({ tone: "conflict", title: "Rebase onto main stopped on 1 conflict. Nothing changed.", files: ["a.ts"], prompt: "Resolve a.ts" });
  });

  it("explains known blocks and passes unknown ones through", () => {
    const dirty = outcomeOf({ kind: "blocked", reason: "worktree-dirty", files: ["x"] }, "main");
    expect(dirty.tone === "blocked" && dirty.detail).toContain("uncommitted changes");
    const other = outcomeOf({ kind: "blocked", reason: "Something new", files: [] }, "main");
    expect(other.tone === "blocked" && other.detail).toBe("Something new");
  });

  it("reads receipts and archive cleanup", () => {
    expect(receiptText({ kind: "landed", sha: "abcdef0123", at: "t" }, "main")).toBe("Landed on main at abcdef0");
    expect(receiptText({ kind: "discarded", at: "t" }, "main")).toBe("Worktree discarded");
    const kept = (reason: string) => archiveNote({ branch: "fix", defaultBranch: "main", archiveCleanup: { kind: "retained", reason } });
    expect(kept("unlanded-commits")).toEqual({ title: "Worktree kept", text: "It has commits that are not on main. Land or discard fix to remove it." });
    expect(kept("shared")?.text).toBe("Another session still works in fix.");
    expect(kept("checkout-changed")?.text).toBe("Its folder or branch changed outside Forgerie. Remove fix yourself if you no longer need it.");
    expect(kept("a new reason")?.text).toBe("a new reason (fix)");
    expect(archiveNote({ branch: "fix", defaultBranch: "main", archiveCleanup: { kind: "removed", cleanup: { kind: "failed", error: "busy" } } }))
      .toEqual({ title: "Worktree not removed", text: "busy (fix)" });
    expect(archiveNote({ branch: "fix", defaultBranch: "main", archiveCleanup: { kind: "retained", reason: "already-completed" } })).toBeUndefined();
    expect(archiveNote({ branch: "fix", defaultBranch: "main", archiveCleanup: { kind: "removed", cleanup: { kind: "done" } } })).toBeUndefined();
  });
});

describe("the worktree adapter", () => {
  it("parses only session.worktree events, and tolerates fields it does not know", () => {
    const raw = { type: "session.worktree", worktree: { ...record(), renamed: true, transcripts: [], createdAt: "t", updatedAt: "t", discardedBranchTip: "abc" } };
    expect(parseWorktreeEvent(raw)?.id).toBe("wt1");
    expect(parseWorktreeEvent({ type: "status.update" })).toBeUndefined();
    expect(parseWorktreeEvent({ type: "session.worktree", worktree: { id: "x" } })).toBeUndefined();
  });

  it("reads an unknown setup phase as still running, never as done", () => {
    expect(worktreeInfoSchema.parse({ ...info(), setup: { phase: "warming", log: "" } }).setup.phase).toBe("starting");
  });

  it("merges a live record over known counts, and drops the counts once the checkout is gone", () => {
    const known = info({ ahead: 3, dirtyFiles: 1 });
    expect(mergeRecord(known, record({ branch: "renamed" }))).toMatchObject({ branch: "renamed", ahead: 3, dirtyFiles: 1 });
    const landed = mergeRecord(known, record({ state: { kind: "landed", sha: "abc", at: "t" } }));
    expect(landed.ahead).toBeUndefined();
    expect(landed.state.kind).toBe("landed");
  });

  it("lets the catalog's live state win over a stale Git read", () => {
    const fetched = info({ ahead: 2 });
    const catalog = info({ branch: "renamed", state: { kind: "landed", sha: "abc", at: "t" } });
    expect(combineWorktree({ catalog, fetched })).toMatchObject({ branch: "renamed", state: { kind: "landed" }, ahead: undefined });
    expect(combineWorktree({ status: info({ ahead: 1 }) })?.ahead).toBe(1);
  });

  it("calls the documented paths and surfaces the server's refusal", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const api = createWorktreeApi(async (path, init) => {
      calls.push([path, init]);
      if (path.endsWith("/land")) return new Response(JSON.stringify({ error: "Finish session setup before landing" }), { status: 409 });
      return new Response(JSON.stringify({ kind: "discarded", cleanup: { kind: "done" } }));
    });
    await expect(api.land("wt 1")).rejects.toThrow("Finish session setup before landing");
    expect(await api.discard("wt1", "tok")).toEqual({ kind: "discarded", cleanup: { kind: "done" } });
    expect(calls.map(([path]) => path)).toEqual(["/api/sessions/worktrees/wt%201/land", "/api/sessions/worktrees/wt1/discard"]);
    expect(calls[1]![1]?.body).toBe(JSON.stringify({ confirmationToken: "tok" }));
    expect(actionResultSchema.safeParse({ kind: "stale-preview" }).success).toBe(true);
  });
});
