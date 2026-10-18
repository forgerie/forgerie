import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { it, vi } from "vitest";
import { SessionWorktrees } from "../src/server/workspaces/sessionWorktrees.js";
import { SessionWorktreeStore } from "../src/server/workspaces/sessionWorktreeStore.js";

const execute = promisify(execFile);
const nullHead = "0".repeat(40);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forgerie checkout "));
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  const calls = join(root, "calls");
  await mkdir(repo); await mkdir(bin);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), PATH: `${bin}:${process.env.PATH}`, CALLS: calls, INSTALL_EXIT: "0" };
  const git = (cwd, ...args) => execute("git", ["-C", cwd, ...args], { env });
  await git(repo, "init", "-b", "main");
  await git(repo, "config", "user.name", "Worktree hook tests");
  await git(repo, "config", "user.email", "hooks@example.invalid");
  await git(repo, "config", "core.hooksPath", ".githooks");
  for (const path of [".githooks/post-checkout", ".forgerie/hooks/worktree-post-create"]) {
    await mkdir(join(repo, path, ".."), { recursive: true });
    await writeFile(join(repo, path), await readFile(new URL(`../${path}`, import.meta.url)), { mode: 0o755 });
  }
  await writeFile(join(bin, "npm"), '#!/bin/sh\nprintf "%s\\n" "$PWD" >> "$CALLS"\nprintf "INSTALL-RUN\\n"\nexit "$INSTALL_EXIT"\n', { mode: 0o755 });
  await git(repo, "add", "."); await git(repo, "commit", "-m", "Hook fixture");
  const installCalls = async () => (await readFile(calls, "utf8").catch(error => { if (error.code !== "ENOENT") throw error; return ""; })).trim().split("\n").filter(Boolean);
  const checkout = async (target, flag = "1") => execute(join(target, ".githooks/post-checkout"), [nullHead, (await git(target, "rev-parse", "HEAD")).stdout.trim(), flag], { cwd: target, env });
  return { root, repo, env, git, installCalls, checkout, close: () => rm(root, { recursive: true, force: true }) };
}

it("sets up a manual linked worktree once and ignores main checkout, branch switches, and file checkouts", async () => {
  const f = await fixture();
  try {
    await f.checkout(f.repo);
    assert.deepEqual(await f.installCalls(), []);
    const target = join(f.root, "manual worktree");
    await f.git(f.repo, "worktree", "add", "-b", "manual", target);
    assert.deepEqual(await f.installCalls(), [target]);
    await f.checkout(target); // A completed lifecycle hook's receipt also suppresses first-checkout replay.
    // Remove the receipt so idempotence cannot hide an incorrect normal-checkout admission.
    const marker = (await f.git(target, "rev-parse", "--git-path", "forgerie-post-create.done")).stdout.trim();
    await rm(marker);
    await f.git(target, "checkout", "-b", "another");
    await f.checkout(target, "0");
    assert.deepEqual(await f.installCalls(), [target]);
    assert.equal((await f.git(target, "status", "--porcelain")).stdout, "", "Setup receipt must not dirty the worktree");
  } finally { await f.close(); }
});

it("keeps managed setup in the lifecycle runner and skips a later Git hook after its receipt", async () => {
  const f = await fixture();
  try {
    for (const key of ["PATH", "CALLS", "INSTALL_EXIT"]) vi.stubEnv(key, f.env[key]);
    const store = new SessionWorktreeStore(join(f.root, "ownership.json"));
    await store.initialize();
    const worktrees = new SessionWorktrees(store);
    const record = await worktrees.create(f.repo);
    assert.match(record.setup.log, /INSTALL-RUN/, "Lifecycle runner must own setup output, not git worktree add");
    assert.deepEqual(await f.installCalls(), [record.path]);
    await f.checkout(record.path);
    assert.deepEqual(await f.installCalls(), [record.path]);
  } finally { vi.unstubAllEnvs(); await f.close(); }
});

it("reports failed manual setup with recovery, leaves no success receipt, and permits a retry", async () => {
  const f = await fixture();
  try {
    const target = join(f.root, "failed worktree");
    f.env.INSTALL_EXIT = "7";
    await assert.rejects(f.git(f.repo, "worktree", "add", "-b", "failed", target), error => {
      assert.match(error.stderr, /Dependency setup failed \(exit 7\)/);
      assert.match(error.stderr, /From that worktree root, run: npm ci/);
      return true;
    });
    const marker = (await f.git(target, "rev-parse", "--git-path", "forgerie-post-create.done")).stdout.trim();
    await assert.rejects(readFile(marker), { code: "ENOENT" });
    f.env.INSTALL_EXIT = "0";
    await execute(join(target, ".forgerie/hooks/worktree-post-create"), [target], { cwd: target, env: f.env });
    await f.checkout(target);
    assert.deepEqual(await f.installCalls(), [target, target]);
    assert.equal(await readFile(marker, "utf8"), "");
  } finally { await f.close(); }
});

it("does not install for --no-checkout creation", async () => {
  const f = await fixture();
  try {
    await f.git(f.repo, "worktree", "add", "--no-checkout", "-b", "deferred", join(f.root, "deferred"));
    assert.deepEqual(await f.installCalls(), []);
  } finally { await f.close(); }
});
