import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { disposableWorktree, SCRATCH_ROOT } from "./disposableWorktrees.js";
import { gatedAction, type GatedActionReads } from "./gatedActions.js";
import {
  applyScratchChange, cloneRepository, createWorktree, deleteRemoteRef, ownsBranches, pushNewRef, removeTree,
  ScratchGitRefusal, type ScratchGitDeps, type ScratchGitOutcome, type ScratchLedger,
} from "./scratchGit.js";

const run = promisify(execFile);
const env = { ...sanitizedGitEnv(), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
const git = async (cwd: string, args: readonly string[]) => (await run("git", ["-C", cwd, ...args], { env, encoding: "utf8" })).stdout;
const exists = (path: string) => stat(path).then(() => true, () => false);

// The gate's scratch exemption is narrowed to the test's scratch root, which sits inside /tmp as in production.
// The test project is then an ordinary checkout that the exemption does not cover.
let base: string; let project: string; let remote: string; let deps: ScratchGitDeps; let ledger: ScratchLedger;
beforeEach(async () => {
  base = await realpath(await mkdtemp(join(SCRATCH_ROOT, "forgerie-scratch-git-test-")));
  project = join(base, "project"); remote = join(base, "remote.git");
  await run("git", ["init", "-q", "--bare", "-b", "main", remote], { env });
  await run("git", ["init", "-q", "-b", "main", project], { env });
  await writeFile(join(project, "file.txt"), "one\n");
  await git(project, ["add", "file.txt"]); await git(project, ["commit", "-qm", "Base"]);
  await git(project, ["remote", "add", "origin", remote]); await git(project, ["push", "-q", "origin", "main"]);
  await git(project, ["remote", "set-head", "origin", "main"]);
  deps = { git, scratchRoot: join(base, "scratch"), now: () => 1, backup: { git, directory: join(base, "backups"), now: () => new Date("2026-10-22T12:00:00Z") } };
  ledger = { trees: {}, remotes: [] };
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

/** Runs one action and applies its ledger change, as the Durable tool does. */
async function act(outcome: Promise<ScratchGitOutcome>): Promise<string> {
  const done = await outcome; applyScratchChange(ledger, done.change); return done.text;
}
const refusal = (outcome: Promise<unknown>) => expect(outcome).rejects.toBeInstanceOf(ScratchGitRefusal);
const reads = (counts?: { git: number; other: number }): GatedActionReads => ({
  git: (cwd, args) => { if (counts !== undefined) counts.git++; return git(cwd, args); },
  issueLabels: () => { if (counts !== undefined) counts.other++; return Promise.resolve([]); },
  disposable: async path => {
    if (counts !== undefined) counts.other++;
    await mkdir(deps.scratchRoot, { recursive: true });
    return disposableWorktree({ scratchRoot: deps.scratchRoot, childWorktrees: () => Promise.resolve([]), projectBackup: deps.backup })(path);
  },
  scratchBranches: (cwd, names) => { if (counts !== undefined) counts.other++; return ownsBranches(git, ledger, cwd, names); },
});
const gate = async (command: string) => (await gatedAction("bash", { command }, project, reads()))?.description;

it("makes a scratch worktree, lets bash discard and merge-preview in it, and removes it", async () => {
  await git(project, ["switch", "-qc", "feature"]); await writeFile(join(project, "feature.txt"), "f\n");
  await git(project, ["add", "feature.txt"]); await git(project, ["commit", "-qm", "Feature"]); await git(project, ["switch", "-q", "main"]);
  expect(await act(createWorktree(deps, ledger, "f-1", { repo: project, name: "x", ref: "main" }, 7))).toContain("(detached)");
  const path = ledger.trees["x"]?.path ?? "";
  expect(path).toBe(join(base, "scratch", "f-1", "x"));
  expect(ledger.trees["x"]).toMatchObject({ kind: "worktree", repo: project, conversation: 7 });
  await writeFile(join(path, "file.txt"), "dirty\n");
  expect(await gate(`cd ${path} && git merge --no-commit --no-ff -q feature; git merge --abort; git reset --hard`)).toBeUndefined();
  expect(await act(removeTree(deps, ledger, "x"))).toBe(`Removed ${path}.`);
  expect(await exists(path)).toBe(false);
  expect(await git(project, ["worktree", "list"])).not.toContain(path);
  expect(ledger.trees).toEqual({});
});

it("clones with shared objects, lets bash check out and discard there, and removes the clone", async () => {
  const sha = (await git(project, ["rev-parse", "HEAD"])).trim();
  expect(await act(cloneRepository(deps, ledger, "f-1", { source: project, name: "y", shared: true }, project, 7))).toContain("Cloned");
  const path = ledger.trees["y"]?.path ?? "";
  expect(await readFile(join(path, ".git", "objects", "info", "alternates"), "utf8")).toContain(project);
  await writeFile(join(path, "file.txt"), "dirty\n");
  expect(await gate(`git -C ${path} checkout -q ${sha} && git -C ${path} checkout -- file.txt`)).toBeUndefined();
  await act(removeTree(deps, ledger, "y"));
  expect(await exists(path)).toBe(false);
});

it("makes a project worktree on a new branch, then removes both after a backup of its uncommitted work", async () => {
  await act(createWorktree(deps, ledger, "f-1", { repo: project, name: "feat", branch: "feat", place: "project" }, 7));
  const path = join(project, ".worktree", "feat");
  expect(ledger.trees["feat"]).toMatchObject({ path, branch: { ref: "refs/heads/feat" } });
  await writeFile(join(path, "work.txt"), "committed\n"); await git(path, ["add", "work.txt"]); await git(path, ["commit", "-qm", "Work"]);
  await writeFile(join(path, "notes.md"), "uncommitted\n");
  expect(await act(removeTree(deps, ledger, "feat"))).toBe(`Removed ${path}. Deleted branch feat. A backup is in ${join(base, "backups")}.`);
  expect(await exists(path)).toBe(false);
  expect(await git(project, ["branch", "--list", "feat"])).toBe("");
  const [folder] = await readdir(join(base, "backups"));
  expect(await readFile(join(base, "backups", folder ?? "", "untracked", "notes.md"), "utf8")).toBe("uncommitted\n");
});

it("starts a worktree made from another worktree at that worktree's HEAD, in the same repository", async () => {
  const child = join(base, "child"); await git(project, ["worktree", "add", "-qb", "child", child]);
  await git(child, ["commit", "-q", "--allow-empty", "-m", "Child work"]);
  await act(createWorktree(deps, ledger, "f-1", { repo: child, name: "probe" }, 7));
  expect(ledger.trees["probe"]?.repo).toBe(project);
  expect(await git(ledger.trees["probe"]?.path ?? "", ["rev-parse", "HEAD"])).toBe(await git(child, ["rev-parse", "HEAD"]));
});

it("cleans up the branch of a scratch tree that was deleted outside Git", async () => {
  await act(createWorktree(deps, ledger, "f-1", { repo: project, name: "gone", branch: "gone" }, 7));
  await rm(ledger.trees["gone"]?.path ?? "", { recursive: true, force: true });
  expect(await act(removeTree(deps, ledger, "gone"))).toBe(`${join(base, "scratch", "f-1", "gone")} was already gone. Deleted branch gone.`);
  expect(await git(project, ["branch", "--list", "gone"])).toBe("");
});

it("lets bash reset an owned tree and delete an owned unmerged branch when both are written literally", async () => {
  await act(createWorktree(deps, ledger, "f-1", { repo: project, name: "own", branch: "own", place: "project" }, 7));
  const path = join(project, ".worktree", "own");
  await writeFile(join(path, "work.txt"), "w\n"); await git(path, ["add", "work.txt"]); await git(path, ["commit", "-qm", "Unmerged work"]);
  await writeFile(join(path, "file.txt"), "dirty\n");
  expect(await gate(`git -C ${path} reset --hard`)).toBeUndefined();
  await git(project, ["worktree", "remove", "--force", path]);
  expect(await gate("git branch -D own")).toBeUndefined();
  expect(await gate(`git -C ${project} branch -D own`)).toBeUndefined();
  expect(await gate("B=own; git branch -D $B")).toBe("Delete an unmerged Git branch");
  expect(await gate("git branch -D own other")).toBe("Delete an unmerged Git branch");
});

it("pushes a new tag and deletes it again while the remote still holds that commit", async () => {
  await act(createWorktree(deps, ledger, "f-1", { repo: project, name: "pub", branch: "pub" }, 7));
  const path = ledger.trees["pub"]?.path ?? "";
  await writeFile(join(path, "build.txt"), "b\n"); await git(path, ["add", "build.txt"]); await git(path, ["commit", "-qm", "Build"]);
  const sha = (await git(path, ["rev-parse", "HEAD"])).trim();
  expect(await act(pushNewRef(deps, ledger, { name: "pub", ref: "HEAD", remoteRef: "refs/tags/build-1" }, 7))).toContain(sha);
  expect(ledger.remotes).toMatchObject([{ ref: "refs/tags/build-1", sha, url: remote }]);
  expect(await git(project, ["ls-remote", remote, "refs/tags/build-1"])).toContain(sha);
  // The scratch tree can go first; the delete runs from the recorded repository.
  await act(removeTree(deps, ledger, "pub"));
  expect(await act(deleteRemoteRef(deps, ledger, { remoteRef: "refs/tags/build-1" }, project))).toBe(`Deleted refs/tags/build-1 from ${remote}.`);
  expect(await git(project, ["ls-remote", remote, "refs/tags/build-1"])).toBe("");
  expect(ledger.remotes).toEqual([]);
});

it("refuses pushes to a default branch or an existing ref, and pushes from trees it does not own", async () => {
  await act(createWorktree(deps, ledger, "f-1", { repo: project, name: "pub", branch: "pub" }, 7));
  await refusal(pushNewRef(deps, ledger, { name: "pub", ref: "HEAD", remoteRef: "refs/heads/main" }, 7));
  await refusal(pushNewRef(deps, ledger, { name: "pub", ref: "HEAD", remoteRef: "main" }, 7));
  await git(project, ["push", "-q", "origin", "main:refs/heads/taken"]);
  await refusal(pushNewRef(deps, ledger, { name: "pub", ref: "HEAD", remoteRef: "refs/heads/taken" }, 7));
  await refusal(pushNewRef(deps, ledger, { name: "nobody", ref: "HEAD", remoteRef: "refs/heads/x" }, 7));
  await git(ledger.trees["pub"]?.path ?? "", ["config", "url.ssh://example.invalid/.pushInsteadOf", remote]);
  await refusal(pushNewRef(deps, ledger, { name: "pub", ref: "HEAD", remoteRef: "refs/heads/rewritten" }, 7));
  expect(ledger.remotes).toEqual([]);
});

it("leaves a pushed ref alone and forgets it after another writer moves it", async () => {
  await act(createWorktree(deps, ledger, "f-1", { repo: project, name: "pub", branch: "pub" }, 7));
  await act(pushNewRef(deps, ledger, { name: "pub", ref: "HEAD", remoteRef: "refs/heads/candidate" }, 7));
  await writeFile(join(project, "other.txt"), "o\n"); await git(project, ["add", "other.txt"]); await git(project, ["commit", "-qm", "Someone else"]);
  await git(project, ["push", "-qf", "origin", "main:refs/heads/candidate"]);
  const moved = (await git(project, ["rev-parse", "HEAD"])).trim();
  expect(await act(deleteRemoteRef(deps, ledger, { remoteRef: "refs/heads/candidate" }, project))).toContain("left alone and forgotten");
  expect(await git(project, ["ls-remote", remote, "refs/heads/candidate"])).toContain(moved);
  expect(ledger.remotes).toEqual([]);
  await refusal(deleteRemoteRef(deps, ledger, { remoteRef: "refs/heads/candidate" }, project));
  await refusal(deleteRemoteRef(deps, ledger, { remoteRef: "refs/heads/main" }, project));
});

it("never hands ownership to a tree or branch that the user recreated under the same name", async () => {
  await act(createWorktree(deps, ledger, "f-1", { repo: project, name: "rep", branch: "rep", place: "project" }, 7));
  const path = join(project, ".worktree", "rep");
  await git(project, ["worktree", "remove", "--force", path]); await git(project, ["branch", "-D", "rep"]);
  await writeFile(join(project, "user.txt"), "u\n"); await git(project, ["add", "user.txt"]); await git(project, ["commit", "-qm", "User"]);
  await git(project, ["worktree", "add", "-qb", "rep", path]);
  await git(project, ["reset", "-q", "--hard", "HEAD~1"]);
  expect(await gate("git branch -D rep")).toBe("Delete an unmerged Git branch");
  expect(await act(removeTree(deps, ledger, "rep"))).toContain("no longer the tree scratch_git made");
  expect(await exists(path)).toBe(true);
  expect(await git(project, ["branch", "--list", "rep"])).toContain("rep");
  expect(ledger.trees).toEqual({});
});

it("stops treating a branch as owned once its reflog is expired", async () => {
  await act(createWorktree(deps, ledger, "f-1", { repo: project, name: "exp", branch: "exp", place: "project" }, 7));
  const path = join(project, ".worktree", "exp");
  await git(path, ["commit", "-q", "--allow-empty", "-m", "Unmerged"]); await git(project, ["worktree", "remove", "--force", path]);
  await git(project, ["reflog", "expire", "--expire=now", "--all"]);
  expect(await gate("git branch -D exp")).toBe("Delete an unmerged Git branch");
});

it("keeps gating discards and branch deletes that are not scratch work", async () => {
  await act(createWorktree(deps, ledger, "f-1", { repo: project, name: "own", place: "project" }, 7));
  await writeFile(join(project, "file.txt"), "user edit\n");
  expect(await gate("git checkout -- file.txt")).toBe("Discard changes with git checkout");
  expect(await gate(`git -C ${project} reset --hard`)).toBe("Discard local changes with git reset --hard");
  expect(await gate(`W=${project}; git -C $W reset --hard`)).toBe("Discard local changes with git reset --hard");
  await git(project, ["switch", "-qc", "mine"]); await git(project, ["commit", "-q", "--allow-empty", "-m", "Mine"]); await git(project, ["switch", "-q", "main"]);
  expect(await gate("git branch -D mine")).toBe("Delete an unmerged Git branch");
  const outside = join(base, "outside"); await mkdir(outside);
  await git(project, ["worktree", "add", "-q", "--detach", join(outside, "tree")]); await writeFile(join(outside, "tree", "file.txt"), "x\n");
  expect(await gate(`git worktree remove ${join(outside, "tree")}`)).toBe("Remove a dirty or unreadable Git worktree");
});

it("refuses to remove a tree outside /tmp when its backup fails", async () => {
  await act(createWorktree(deps, ledger, "f-1", { repo: project, name: "nested", place: "project" }, 7));
  const path = join(project, ".worktree", "nested");
  await run("git", ["clone", "-q", project, join(path, "nested-repo")], { env });
  await refusal(removeTree(deps, ledger, "nested"));
  expect(await exists(join(path, "nested-repo"))).toBe(true);
  expect(Object.keys(ledger.trees)).toEqual(["nested"]);
});

it("refuses names and paths that already exist, and leaves no folder behind when Git fails", async () => {
  await mkdir(join(base, "scratch", "f-1", "taken"), { recursive: true });
  await refusal(createWorktree(deps, ledger, "f-1", { repo: project, name: "taken" }, 7));
  await refusal(createWorktree(deps, ledger, "f-1", { repo: project, name: "../escape" }, 7));
  await refusal(createWorktree(deps, ledger, "f-1", { repo: project, name: "s-0123abcd" }, 7));
  await refusal(createWorktree(deps, ledger, "f-1", { repo: project, name: "opt", ref: "--orphan" }, 7));
  await expect(createWorktree(deps, ledger, "f-1", { repo: project, name: "dup", branch: "main" }, 7)).rejects.toThrow();
  expect(await exists(join(base, "scratch", "f-1", "dup"))).toBe(false);
  expect(await git(project, ["rev-parse", "main"])).not.toBe("");
  expect(ledger.trees).toEqual({});
});

it("does no Git or ownership reads for a bash call without Git", async () => {
  const counts = { git: 0, other: 0 };
  for (const command of ["echo hi", "ls -la | head -3", "npm test -- scratch", "cd /tmp && cat notes.txt"]) {
    expect(await gatedAction("bash", { command }, project, reads(counts))).toBeUndefined();
  }
  expect(counts).toEqual({ git: 0, other: 0 });
});
