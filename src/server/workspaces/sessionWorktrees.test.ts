import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { SessionWorktreeStore } from "./sessionWorktreeStore.js";
import { SessionWorktrees } from "./sessionWorktrees.js";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); roots.length = 0; });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forgerie-session-worktree-"));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  const git = async (cwd: string, ...args: string[]) => (await exec("git", ["-C", cwd, ...args])).stdout.trim();
  await git(repo, "init", "-b", "trunk");
  await git(repo, "config", "user.email", "test@example.invalid");
  await git(repo, "config", "user.name", "Test");
  await writeFile(join(repo, "file.txt"), "base\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "base");
  const store = new SessionWorktreeStore(join(root, "worktrees.json"));
  await store.initialize();
  const events: unknown[] = [];
  const worktrees = new SessionWorktrees(store, { publish: (record) => { events.push(record); } });
  const record = await worktrees.create(repo, "token");
  const transcript = join(root, "session.jsonl");
  await writeFile(transcript, "transcript outside workspace\n");
  await worktrees.attach(record.id, { id: "owner", cwd: record.path, path: transcript });
  const current = await store.require(record.id);
  const session = { id: "owner", cwd: current.path, path: transcript };
  return { root, repo, git, store, worktrees, record: current, session, events };
}

async function commit(f: Awaited<ReturnType<typeof fixture>>, cwd: string, content: string) {
  await writeFile(join(cwd, "file.txt"), content);
  await f.git(cwd, "add", "file.txt");
  await f.git(cwd, "commit", "-m", content.trim());
}

describe("session-owned worktrees with real git", () => {
  it("creates from the default branch tip, excludes .worktrees, and persists ownership", async () => {
    const f = await fixture();
    expect(f.record.defaultBranch).toBe("trunk");
    expect(await f.git(f.repo, "status", "--porcelain")).toBe("");
    expect(await readFile(join(f.repo, ".git/info/exclude"), "utf8")).toContain("/.worktrees/");
    expect(f.record.path).toContain("/.worktrees/");
    expect(await f.git(f.record.path, "rev-parse", "HEAD")).toBe(await f.git(f.repo, "rev-parse", "trunk"));
    const reloaded = new SessionWorktreeStore(join(f.root, "worktrees.json"));
    await reloaded.initialize();
    expect((await reloaded.require(f.record.id)).sessionId).toBe("owner");
  });

  it("keeps a worktree's git counts for the status window, refreshes after it, and forgets them when the record changes", async () => {
    const f = await fixture();
    let now = 1_000_000;
    const cached = new SessionWorktrees(f.store, { publish: () => undefined }, { now: () => now, statusCacheMs: 10_000 });
    expect(await cached.info(f.record, f.session.id)).toMatchObject({ ahead: 0, dirtyFiles: 0 });
    await commit(f, f.record.path, "one ahead\n");
    await writeFile(join(f.record.path, "scratch.txt"), "dirty\n");
    // Inside the window the last answer stands, even though git would now say otherwise.
    now += 9_999;
    expect(await cached.info(f.record, f.session.id)).toMatchObject({ ahead: 0, dirtyFiles: 0 });
    expect(await f.worktrees.info(f.record, f.session.id)).toMatchObject({ ahead: 1, dirtyFiles: 1 });
    now += 1;
    expect(await cached.info(f.record, f.session.id)).toMatchObject({ ahead: 1, dirtyFiles: 1 });
    // A change to the record is seen at once: the next read asks git again.
    await commit(f, f.record.path, "two ahead\n");
    expect(await cached.info(f.record, f.session.id)).toMatchObject({ ahead: 1 });
    await cached.renameFromTitle(f.session.id, "Renamed");
    const renamed = await f.store.require(f.record.id);
    expect(await cached.info(renamed, f.session.id)).toMatchObject({ ahead: 2, branch: renamed.branch });
    // Concurrent readers share one answer.
    now += 10_000;
    await commit(f, renamed.path, "three ahead\n");
    const answers = await Promise.all(Array.from({ length: 5 }, () => cached.info(renamed, f.session.id)));
    expect(answers.map((info) => info.ahead)).toEqual([3, 3, 3, 3, 3]);
  });

  it("allocates a child at the parent's HEAD and reuses its receipt after interrupted setup", async () => {
    const f = await fixture();
    await commit(f, f.record.path, "parent branch\n");
    const parentHead = await f.git(f.record.path, "rev-parse", "HEAD");
    const first = await f.worktrees.createForChild(f.session, "task-42");
    expect(first.sourceCommit).toBe(parentHead);
    expect(await f.git(first.path, "rev-parse", "HEAD")).toBe(parentHead);
    expect(await f.worktrees.info(first, f.session.id)).toMatchObject({ ahead: 0, dirtyFiles: 0 });
    // Model a crash after Git created the checkout but before setup completion was saved.
    await f.store.update(first.id, { setup: { phase: "creating", log: "interrupted" } });
    await commit(f, f.record.path, "parent advanced\n");
    const restored = new SessionWorktreeStore(join(f.root, "worktrees.json"));
    await restored.initialize();
    const resumed = new SessionWorktrees(restored);
    const again = await resumed.createForChild(f.session, "task-42");
    expect(again).toMatchObject({ id: first.id, path: first.path, branch: first.branch, sourceCommit: parentHead, setup: { phase: "done" } });
    expect(await f.git(again.path, "rev-parse", "HEAD")).toBe(parentHead);
    expect((await restored.list()).filter((item) => item.sourceCommit !== undefined)).toHaveLength(1);
    const same = await Promise.all([resumed.createForChild(f.session, "task-42"), resumed.createForChild(f.session, "task-42")]);
    expect(same.map((item) => item.path)).toEqual([first.path, first.path]);
    const another = await resumed.createForChild(f.session, "task-43");
    expect(another.path).not.toBe(first.path);
    expect(await f.worktrees.land(f.record.id, [f.session])).toMatchObject({ kind: "blocked", reason: "related-worktrees-active" });
    await expect(resumed.create(f.repo, undefined, first.id)).rejects.toThrow("Only an unowned setup");
    await expect(resumed.attach(first.id, { ...f.session, cwd: first.path })).rejects.toThrow("ownership");
  });

  it("keeps a legacy child allocation at its persisted path while new allocations use .worktrees", async () => {
    const f = await fixture();
    const record = await f.worktrees.createForChild(f.session, "legacy-task");
    const legacy = join(f.repo, ".worktree", "legacy-child");
    await mkdir(join(f.repo, ".worktree"));
    await f.git(f.repo, "worktree", "move", record.path, legacy);
    await f.store.update(record.id, { path: legacy });
    expect((await f.worktrees.createForChild(f.session, "legacy-task")).path).toBe(legacy);
    expect((await f.worktrees.createForChild(f.session, "new-task")).path).toContain("/.worktrees/");
    await access(legacy);
  });

  it("rebases and lands, preserves a read-only transcript, removes the worktree and branch", async () => {
    const f = await fixture();
    await commit(f, f.record.path, "feature\n");
    const result = await f.worktrees.land(f.record.id, [f.session]);
    expect(result.kind).toBe("landed");
    expect(await readFile(join(f.repo, "file.txt"), "utf8")).toBe("feature\n");
    await expect(access(f.record.path)).rejects.toThrow();
    await expect(f.git(f.repo, "show-ref", "--verify", `refs/heads/${f.record.branch}`)).rejects.toThrow();
    const readonly = await f.store.readOnly(f.session);
    expect(readonly?.state.kind).toBe("landed");
    if (readonly === undefined) throw new Error("Expected a saved transcript");
    expect(await readFile(readonly.transcriptPath, "utf8")).toContain("transcript outside workspace");
  });

  it("aborts rebase conflicts and reports files without leaving a rebase in progress", async () => {
    const f = await fixture();
    await commit(f, f.record.path, "feature\n");
    await commit(f, f.repo, "main\n");
    const result = await f.worktrees.land(f.record.id, [f.session]);
    expect(result).toMatchObject({ kind: "conflict", files: ["file.txt"] });
    expect(await f.git(f.record.path, "status", "--porcelain")).toBe("");
    expect(await readFile(join(f.record.path, "file.txt"), "utf8")).toBe("feature\n");
    expect((await f.store.require(f.record.id)).state.kind).toBe("active");
  });

  it("refuses dirty overlapping main files but allows unrelated main edits", async () => {
    const f = await fixture();
    await commit(f, f.record.path, "feature\n");
    await writeFile(join(f.repo, "file.txt"), "main dirty\n");
    expect(await f.worktrees.land(f.record.id, [f.session])).toMatchObject({ kind: "blocked", reason: "main-dirty", files: ["file.txt"] });
    await f.git(f.repo, "restore", "file.txt");
    await writeFile(join(f.repo, "unrelated.txt"), "keep me\n");
    expect((await f.worktrees.land(f.record.id, [f.session])).kind).toBe("landed");
    expect(await readFile(join(f.repo, "unrelated.txt"), "utf8")).toBe("keep me\n");
  });

  it("requires a current discard preview and preserves the transcript before deleting unlanded commits", async () => {
    const f = await fixture();
    await commit(f, f.record.path, "feature\n");
    const preview = await f.worktrees.discardPreview(f.record.id);
    expect(preview.commits).toHaveLength(1);
    await writeFile(join(f.record.path, "file.txt"), "dirty\n");
    expect((await f.worktrees.discard(f.record.id, preview.confirmationToken, [f.session])).kind).toBe("stale-preview");
    const latest = await f.worktrees.discardPreview(f.record.id);
    expect(latest.dirtyFiles).toEqual(["file.txt"]);
    expect((await f.worktrees.discard(f.record.id, latest.confirmationToken, [f.session])).kind).toBe("discarded");
    await expect(access(f.record.path)).rejects.toThrow();
    expect((await f.store.readOnly(f.session))?.state.kind).toBe("discarded");
  });

  it("archive cleanup retains dirty, unlanded, or shared worktrees and removes only a clean landed one", async () => {
    const f = await fixture();
    await commit(f, f.record.path, "feature\n");
    expect(await f.worktrees.archiveCleanup(f.record.id, [f.session])).toMatchObject({ kind: "retained", reason: "unlanded-commits" });
    await f.git(f.repo, "merge", "--ff-only", f.record.branch);
    await writeFile(join(f.record.path, "untracked.txt"), "dirty\n");
    expect(await f.worktrees.archiveCleanup(f.record.id, [f.session])).toMatchObject({ kind: "retained", reason: "dirty" });
    await rm(join(f.record.path, "untracked.txt"));
    const other = { ...f.session, id: "other", cwd: join(f.record.path, "subdir") };
    expect(await f.worktrees.archiveCleanup(f.record.id, [f.session, other])).toMatchObject({ kind: "retained", reason: "shared" });
    expect((await f.worktrees.archiveCleanup(f.record.id, [f.session])).kind).toBe("removed");
    expect((await f.store.readOnly(f.session))?.state.kind).toBe("landed");
  });

  it("archive cleanup keeps a checkout switched outside Forgerie and reports a code, not git's words", async () => {
    const f = await fixture();
    await f.git(f.record.path, "switch", "-c", "elsewhere");
    expect(await f.worktrees.archiveCleanup(f.record.id, [f.session])).toEqual({ kind: "retained", reason: "checkout-changed" });
    await access(f.record.path);
  });

  it("streams and retains a failed post-create hook and prevents a failed pre-remove hook from deleting", async () => {
    const f = await fixture();
    await mkdir(join(f.repo, ".forgerie/hooks"), { recursive: true });
    await writeFile(join(f.repo, ".forgerie/hooks/worktree-post-create"), "#!/bin/sh\nprintf 'setup failed\\n'\nexit 7\n", { mode: 0o755 });
    await expect(f.worktrees.create(f.repo, "failure-token")).rejects.toThrow("7");
    const failed = (await f.store.list()).find((r) => r.startupToken === "failure-token");
    expect(failed?.setup).toMatchObject({ phase: "failed", exitCode: 7 });
    expect(failed?.setup.log).toContain("setup failed");
    await writeFile(join(f.repo, ".forgerie/hooks/worktree-pre-remove"), "#!/bin/sh\nexit 8\n", { mode: 0o755 });
    const preview = await f.worktrees.discardPreview(f.record.id);
    expect(await f.worktrees.discard(f.record.id, preview.confirmationToken, [f.session])).toMatchObject({ kind: "discarded", cleanup: { kind: "failed" } });
    await access(f.record.path);
    await writeFile(join(f.record.path, "file.txt"), "changed after failed cleanup\n");
    expect(await f.worktrees.discard(f.record.id, preview.confirmationToken, [f.session])).toMatchObject({ kind: "stale-preview" });
    const updated = await f.worktrees.discardPreview(f.record.id);
    await rm(join(f.repo, ".forgerie/hooks/worktree-pre-remove"));
    expect(await f.worktrees.discard(f.record.id, updated.confirmationToken, [f.session])).toMatchObject({ kind: "discarded", cleanup: { kind: "done" } });
  });

  it("confirms service shutdown before hooks and retries the shutdown gate after a landed receipt", async () => {
    const f = await fixture();
    let allowed = false;
    let attempts = 0;
    const guarded = new SessionWorktrees(f.store, {
      publish() { /* The assertions read the durable cleanup receipt. */ },
      async stopServices(record) {
        attempts++;
        await expect(f.store.assertWritable(f.session)).rejects.toThrow();
        await access(record.path);
        if (!allowed) throw new Error("Service owner is unavailable");
        await writeFile(join(f.repo, "services-stopped"), "confirmed");
      },
    });
    await mkdir(join(f.repo, ".forgerie/hooks"), { recursive: true });
    await writeFile(join(f.repo, ".forgerie/hooks/worktree-pre-remove"), '#!/bin/sh\ntest -f "$FORGERIE_REPO_PATH/services-stopped" || exit 9\nprintf "hook ran" > "$FORGERIE_REPO_PATH/hook-ran"\n', { mode: 0o755 });
    await commit(f, f.record.path, "feature\n");
    expect(await guarded.land(f.record.id, [f.session])).toMatchObject({ kind: "landed", cleanup: { kind: "failed", error: "Service owner is unavailable" } });
    await access(f.record.path);
    await expect(access(join(f.repo, "hook-ran"))).rejects.toThrow();
    allowed = true;
    expect(await guarded.land(f.record.id, [f.session])).toMatchObject({ kind: "landed", cleanup: { kind: "done" } });
    expect(attempts).toBe(2);
    expect(await readFile(join(f.repo, "hook-ran"), "utf8")).toBe("hook ran");
    await expect(access(f.record.path)).rejects.toThrow();
  });

  it("does not remove new unlanded commits during a failed Land cleanup retry", async () => {
    const f = await fixture();
    await mkdir(join(f.repo, ".forgerie/hooks"), { recursive: true });
    const hookPath = join(f.repo, ".forgerie/hooks/worktree-pre-remove");
    await writeFile(hookPath, "#!/bin/sh\nexit 8\n", { mode: 0o755 });
    await commit(f, f.record.path, "land first\n");
    expect(await f.worktrees.land(f.record.id, [f.session])).toMatchObject({ kind: "landed", cleanup: { kind: "failed" } });
    await commit(f, f.record.path, "unlanded after failed cleanup\n");
    await rm(hookPath);
    expect(await f.worktrees.land(f.record.id, [f.session])).toMatchObject({ kind: "landed", cleanup: { kind: "failed" } });
    expect(await readFile(join(f.record.path, "file.txt"), "utf8")).toBe("unlanded after failed cleanup\n");
  });

  it("gates session input and leaves git unchanged when an active session refuses removal", async () => {
    const f = await fixture();
    await commit(f, f.record.path, "feature\n");
    const guarded = new SessionWorktrees(f.store, {
      publish() { /* The assertion observes the durable gate. */ },
      async beforeRemoval() {
        await expect(f.store.assertWritable(f.session)).rejects.toThrow("lifecycle action");
        throw new Error("Agent still working");
      },
    });
    await expect(guarded.land(f.record.id, [f.session])).rejects.toThrow("Agent still working");
    expect((await f.store.require(f.record.id)).state.kind).toBe("active");
    expect((await f.store.require(f.record.id)).operation).toBeUndefined();
    expect(await readFile(join(f.repo, "file.txt"), "utf8")).toBe("base\n");
  });

  it("reconciles a durable rename intent after restart", async () => {
    const f = await fixture();
    await f.store.update(f.record.id, { pendingRename: { from: f.record.branch, to: "renamed-before-crash" } });
    await f.git(f.record.path, "branch", "-m", "renamed-before-crash");
    const reloaded = new SessionWorktreeStore(join(f.root, "worktrees.json"));
    await reloaded.initialize();
    const service = new SessionWorktrees(reloaded);
    await service.initialize();
    expect(await reloaded.require(f.record.id)).toMatchObject({ branch: "renamed-before-crash", renamed: true });
    expect((await reloaded.require(f.record.id)).pendingRename).toBeUndefined();
  });

  it("serializes concurrent allocations and retains interrupted setup logs", async () => {
    const f = await fixture();
    const records = await Promise.all([f.worktrees.create(f.repo), f.worktrees.create(f.repo)]);
    expect(new Set(records.map((record) => record.path)).size).toBe(2);
    await f.store.update(records[0].id, { setup: { phase: "hook", log: "saved before restart" } });
    const reloaded = new SessionWorktreeStore(join(f.root, "worktrees.json"));
    await reloaded.initialize();
    expect((await reloaded.require(records[0].id)).setup).toMatchObject({ phase: "failed", log: "saved before restart" });
  });

  it("renames from a title with a suffix and never renames a pushed branch", async () => {
    const f = await fixture();
    await f.git(f.repo, "branch", "fix-a-bug");
    await f.worktrees.renameFromTitle("owner", "Fix a bug");
    expect((await f.store.require(f.record.id)).branch).toBe("fix-a-bug-2");
    const second = await f.worktrees.create(f.repo);
    await f.worktrees.attach(second.id, { ...f.session, id: "pushed", cwd: second.path });
    await commit(f, second.path, "published commit\n");
    await f.git(f.repo, "update-ref", "refs/remotes/origin/published", await f.git(second.path, "rev-parse", "HEAD"));
    await f.worktrees.renameFromTitle("pushed", "Published title");
    expect((await f.store.require(second.id)).branch).toBe(second.branch);
  });
});
