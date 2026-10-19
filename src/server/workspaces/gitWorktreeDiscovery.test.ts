import { describe, expect, it } from "vitest";
import { GitWorktreeDiscovery, parseGitWorktreeList } from "./gitWorktreeDiscovery.js";

// Fixtures below are verbatim `git worktree list --porcelain` output captured from real git.
const mainAndLinked = [
  "worktree /repo",
  "HEAD ad580ab86e1eba35a121fa6b9e8be1126aaf18de",
  "branch refs/heads/main",
  "",
  "worktree /repo-worktrees/feature",
  "HEAD ad580ab86e1eba35a121fa6b9e8be1126aaf18de",
  "branch refs/heads/feat/thing",
  "",
].join("\n");

const removedAndLocked = [
  "worktree /repo",
  "HEAD ad580ab86e1eba35a121fa6b9e8be1126aaf18de",
  "branch refs/heads/main",
  "",
  "worktree /repo-worktrees/gone",
  "HEAD ad580ab86e1eba35a121fa6b9e8be1126aaf18de",
  "branch refs/heads/gone",
  "prunable gitdir file points to non-existent location",
  "",
  "worktree /repo-worktrees/kept",
  "HEAD ad580ab86e1eba35a121fa6b9e8be1126aaf18de",
  "branch refs/heads/kept",
  "locked keep me",
  "",
].join("\n");

describe("parseGitWorktreeList", () => {
  it("reads paths and short branch names for the main and linked worktrees", () => {
    expect(parseGitWorktreeList(mainAndLinked)).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/repo-worktrees/feature", branch: "feat/thing" },
    ]);
  });

  it("reports prunable, and leaves a locked worktree looking like the usable checkout it is", () => {
    expect(parseGitWorktreeList(removedAndLocked)).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/repo-worktrees/gone", branch: "gone", prunable: true },
      // `locked` is ignored: a locked worktree is a real checkout and stays a usable
      // workspace, so nothing downstream needs to distinguish it.
      { path: "/repo-worktrees/kept", branch: "kept" },
    ]);

    const bareLocked = ["worktree /repo-worktrees/kept", "HEAD abc", "detached", "locked", ""].join("\n");
    expect(parseGitWorktreeList(bareLocked)).toEqual([{ path: "/repo-worktrees/kept", detached: true }]);
  });

  it("reads bare repositories and ignores chunks without a worktree path", () => {
    const bare = ["worktree /repo.git", "bare", "", "HEAD abc", ""].join("\n");
    expect(parseGitWorktreeList(bare)).toEqual([{ path: "/repo.git", bare: true }]);
  });

  it("returns nothing for empty output", () => {
    expect(parseGitWorktreeList("\n")).toEqual([]);
  });
});

describe("cached git workspace discovery", () => {
  function fixture(cacheMs?: number) {
    let now = 1_000_000;
    const calls = { repository: 0, worktrees: 0 };
    const git = new GitWorktreeDiscovery({
      isGitRepository() { calls.repository++; return Promise.resolve(true); },
      discoverGitWorktrees(path) { calls.worktrees++; return Promise.resolve([{ path, branch: "main" }]); },
    }, { now: () => now, ...(cacheMs === undefined ? {} : { cacheMs }) });
    return { git, calls, advance: (ms: number) => { now += ms; } };
  }

  it("reuses both git answers by path inside the window and refreshes at expiry", async () => {
    const f = fixture(10_000);
    const read = async (path: string) => Promise.all([f.git.isGitRepository(path), f.git.discoverGitWorktrees(path)]);
    expect(await read("/repo")).toEqual([true, [{ path: "/repo", branch: "main" }]]);
    f.advance(9_999);
    await read("/repo");
    expect(f.calls).toEqual({ repository: 1, worktrees: 1 });
    await read("/other");
    expect(f.calls).toEqual({ repository: 2, worktrees: 2 });
    f.advance(1);
    await read("/repo");
    expect(f.calls).toEqual({ repository: 3, worktrees: 3 });
  });

  it("shares a run between concurrent readers, including reads beyond the window while pending", async () => {
    let now = 0;
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const calls = { repository: 0, worktrees: 0 };
    const git = new GitWorktreeDiscovery({
      async isGitRepository() { calls.repository++; await pending; return false; },
      async discoverGitWorktrees(path) { calls.worktrees++; await pending; return [{ path }]; },
    }, { cacheMs: 10_000, now: () => now });
    const first = [git.isGitRepository("/repo"), git.discoverGitWorktrees("/repo")];
    now = 10_001;
    const others = Array.from({ length: 5 }, () => [git.isGitRepository("/repo"), git.discoverGitWorktrees("/repo")]).flat();
    expect(calls).toEqual({ repository: 1, worktrees: 1 });
    finish();
    expect(await Promise.all([...first, ...others])).toHaveLength(12);
    expect(await git.isGitRepository("/repo")).toBe(false);
    expect(calls.repository).toBe(1);
  });

  it("does not cache by default", async () => {
    const f = fixture();
    for (let i = 0; i < 2; i++) {
      await f.git.isGitRepository("/repo");
      await f.git.discoverGitWorktrees("/repo");
    }
    expect(f.calls).toEqual({ repository: 2, worktrees: 2 });
  });

  it("retries rejected reads without discarding a newer read after invalidation", async () => {
    let reject: (error: Error) => void = () => undefined;
    const failed = new Promise<never>((_resolve, failure) => { reject = failure; });
    let calls = 0;
    const git = new GitWorktreeDiscovery({
      isGitRepository() { return Promise.resolve(true); },
      async discoverGitWorktrees(path) { calls++; if (calls === 1) return failed; return [{ path }]; },
    }, { cacheMs: 10_000 });
    const old = git.discoverGitWorktrees("/repo");
    const rejected = expect(old).rejects.toThrow("git failed");
    git.invalidate();
    expect(await git.discoverGitWorktrees("/repo")).toEqual([{ path: "/repo" }]);
    reject(new Error("git failed"));
    await rejected;
    await git.discoverGitWorktrees("/repo");
    expect(calls).toBe(2);
  });

  it("does not hold rejected git reads for the window", async () => {
    let calls = 0;
    let repositoryCalls = 0;
    const git = new GitWorktreeDiscovery({
      isGitRepository() { repositoryCalls++; return Promise.reject(new Error("unavailable")); },
      discoverGitWorktrees(path) { return ++calls === 1 ? Promise.reject(new Error("unavailable")) : Promise.resolve([{ path }]); },
    }, { cacheMs: 10_000 });
    await expect(git.isGitRepository("/repo")).rejects.toThrow("unavailable");
    await expect(git.isGitRepository("/repo")).rejects.toThrow("unavailable");
    expect(repositoryCalls).toBe(2);
    await expect(git.discoverGitWorktrees("/repo")).rejects.toThrow("unavailable");
    expect(await git.discoverGitWorktrees("/repo")).toEqual([{ path: "/repo" }]);
    expect(calls).toBe(2);
  });
});
