import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Check } from "typebox/value";
import type { SessionWorktreeRecord } from "../../shared/sessionWorktree.js";
import { WorktreeCleanupReportSchema, WorktreeCleanupStateSchema } from "../../shared/worktreeCleanup.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { SessionWorktreeStore } from "./sessionWorktreeStore.js";
import { SessionWorktrees } from "./sessionWorktrees.js";
import { WorktreeCleanupJob } from "./worktreeCleanupJob.js";

const execute = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await execute("git", ["-C", cwd, ...args], { env: sanitizedGitEnv() })).stdout.trim();
const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture(options: { inUse?: (record: SessionWorktreeRecord) => Promise<boolean>; beforeRemoval?: (record: SessionWorktreeRecord) => Promise<readonly []> } = {}) {
  const root = await mkdtemp(join(tmpdir(), "forgerie-cleanup-job-"));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  await git(repo, "init", "-b", "main");
  await git(repo, "config", "user.email", "test@example.invalid");
  await git(repo, "config", "user.name", "Test");
  await writeFile(join(repo, "base.txt"), "base\n");
  await writeFile(join(repo, ".gitignore"), "private.txt\nnode_modules/\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "base");
  const store = new SessionWorktreeStore(join(root, "ownership.json"));
  await store.initialize();
  const worktrees = new SessionWorktrees(store, { publish: () => undefined, ...(options.beforeRemoval === undefined ? {} : { beforeRemoval: options.beforeRemoval }) });
  const live = new Set<string>();
  const job = new WorktreeCleanupJob({ worktrees, inUse: options.inUse ?? ((record) => Promise.resolve(live.has(record.id))) });
  const create = async () => {
    const record = await worktrees.create(repo);
    return store.update(record.id, { setup: { ...record.setup, phase: "done" } });
  };
  return { root, repo, store, worktrees, job, create, live };
}

async function hook(repo: string, body: string): Promise<void> {
  await mkdir(join(repo, ".forgerie/hooks"), { recursive: true });
  await writeFile(join(repo, ".forgerie/hooks/worktree-pre-remove"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

describe("owned worktree cleanup with real Git", () => {
  it("keeps dirty, unmerged, and in-use worktrees and removes one clean merged checkout", async () => {
    const f = await fixture();
    const dirty = await f.create();
    const unmerged = await f.create();
    const live = await f.create();
    const clean = await f.create();
    await writeFile(join(dirty.path, "notes.txt"), "keep uncommitted work\n");
    await writeFile(join(unmerged.path, "change.txt"), "keep unique commit\n");
    await git(unmerged.path, "add", "change.txt");
    await git(unmerged.path, "commit", "-m", "unique work");
    f.live.add(live.id);
    // An unmanaged checkout is outside the job's ownership inventory, even when clean and merged.
    const unmanaged = join(f.repo, ".worktrees", "another-agent");
    await git(f.repo, "worktree", "add", "-b", "another-agent", unmanaged, "main");
    const report = await f.job.run();
    expect(Check(WorktreeCleanupReportSchema, report)).toBe(true);
    expect(report.kept.map((item) => [item.id, item.reason])).toEqual([[dirty.id, "dirty"], [unmerged.id, "unmerged"], [live.id, "in-use"]]);
    expect(report.removed.map((item) => item.id)).toEqual([clean.id]);
    await expect(access(clean.path)).rejects.toThrow();
    await expect(git(f.repo, "show-ref", "--verify", `refs/heads/${clean.branch}`)).rejects.toThrow();
    expect(await readFile(join(dirty.path, "notes.txt"), "utf8")).toContain("keep uncommitted");
    await access(unmerged.path);
    await access(live.path);
    await access(unmanaged);
    expect(await f.store.require(clean.id)).toMatchObject({ state: { kind: "landed" }, cleanup: { kind: "done" } });
    expect(f.job.snapshot()).toEqual({ phase: "done", report });
    expect(Check(WorktreeCleanupStateSchema, f.job.snapshot())).toBe(true);
  });

  it("keeps ignored files, including files a successful removal hook adds", async () => {
    const f = await fixture();
    const ignored = await f.create();
    await writeFile(join(ignored.path, "private.txt"), "keep ignored data\n");
    expect((await f.job.run()).kept).toMatchObject([{ id: ignored.id, reason: "dirty" }]);
    expect(await readFile(join(ignored.path, "private.txt"), "utf8")).toContain("keep ignored");
    await rm(join(ignored.path, "private.txt"));
    await hook(f.repo, 'printf "hook data\\n" > "$1/private.txt"');
    expect((await f.job.run()).kept).toMatchObject([{ id: ignored.id, reason: "dirty" }]);
    expect(await readFile(join(ignored.path, "private.txt"), "utf8")).toContain("hook data");
    expect((await f.store.require(ignored.id)).state.kind).toBe("active");
    await expect(f.store.assertWritable({ id: "repair-session", cwd: ignored.path })).resolves.toBeUndefined();
    await expect(git(f.repo, "show-ref", "--verify", `refs/heads/${ignored.branch}`)).resolves.toContain(ignored.branch);
  });

  it("rechecks use after admission and never removes a newly used checkout", async () => {
    const live = new Set<string>();
    const f = await fixture({ inUse: (record) => Promise.resolve(live.has(record.id)), beforeRemoval: (record) => { live.add(record.id); return Promise.resolve([]); } });
    const record = await f.create();
    expect((await f.job.run()).kept).toMatchObject([{ id: record.id, reason: "in-use" }]);
    await access(record.path);
    expect((await f.store.require(record.id)).operation).toBeUndefined();
    expect((await f.store.require(record.id)).state.kind).toBe("active");
  });

  it("keeps failed hooks writable and does not record a successful removal", async () => {
    const f = await fixture();
    const record = await f.create();
    await hook(f.repo, "exit 17");
    const report = await f.job.run();
    expect(report.kept).toMatchObject([{ id: record.id, reason: "error" }]);
    expect(report.kept[0]?.detail).toContain("Pre-remove hook exited with 17");
    await access(record.path);
    expect(await f.store.require(record.id)).toMatchObject({ state: { kind: "active" }, cleanup: { kind: "failed" } });
    await expect(f.store.assertWritable({ id: "repair-session", cwd: record.path })).resolves.toBeUndefined();
  });

  it("keeps incomplete setups and externally changed checkouts, and reports use-check failures", async () => {
    const errors = new Set<string>();
    const f = await fixture({ inUse: (record) => { if (errors.has(record.id)) throw new Error("session inventory unavailable"); return Promise.resolve(false); } });
    const setup = await f.worktrees.create(f.repo);
    const switched = await f.create();
    const failed = await f.create();
    await git(switched.path, "switch", "-c", "external-change");
    errors.add(failed.id);
    expect((await f.job.run()).kept).toMatchObject([
      { id: setup.id, reason: "setup-incomplete" },
      { id: switched.id, reason: "checkout-changed" },
      { id: failed.id, reason: "error", detail: "session inventory unavailable" },
    ]);
    for (const record of [setup, switched, failed]) await access(record.path);
  });

  it("coalesces callers, reports running state, and seals admission on stop", async () => {
    let release!: (live: boolean) => void;
    const blocked = new Promise<boolean>((resolve) => { release = resolve; });
    const f = await fixture({ inUse: () => blocked });
    await f.create();
    expect(f.job.snapshot()).toEqual({ phase: "never-run" });
    const first = f.job.run();
    expect(f.job.run()).toBe(first);
    expect(f.job.snapshot()).toEqual({ phase: "running" });
    release(true);
    const report = await first;
    expect(report.kept).toHaveLength(1);
    const copy = f.job.snapshot();
    if (copy.phase === "done") copy.report.kept.length = 0;
    expect(f.job.snapshot()).toEqual({ phase: "done", report });
    await f.job.stop();
    await expect(f.job.run()).rejects.toThrow("stopping");
  });

  it("runs at startup and on its interval, then cancels the interval", async () => {
    let checks = 0;
    const f = await fixture({ inUse: () => { checks++; return Promise.resolve(true); } });
    await f.create();
    vi.useFakeTimers();
    f.job.start(500);
    await f.job.run();
    expect(checks).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(checks).toBe(2);
    await f.job.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(checks).toBe(2);
  });
});
