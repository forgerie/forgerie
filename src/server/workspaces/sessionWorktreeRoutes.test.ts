import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import type { ClientSession } from "../types.js";
import type { SessionWorktreeRecord } from "../../shared/sessionWorktree.js";
import { PiSessionService } from "../sessions/piSessionService.js";
import { registerSessionRoutes } from "../sessions/sessionRoutes.js";
import { emptyArchiveStore, fakeRuntime, fakeSessionManager, sessionGateway, testModelRuntime } from "../sessions/piSessionService.testSupport.js";
import { SessionWorktreeStore } from "./sessionWorktreeStore.js";
import { SessionWorktrees } from "./sessionWorktrees.js";
import { UserSessionWorktrees, registerSessionWorktreeRoutes } from "./sessionWorktreeRoutes.js";

const execute = promisify(execFile);
const roots: string[] = [];
const disposals: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(gitProject = true) {
  const root = await mkdtemp(join(tmpdir(), "forgerie-worktree-api-"));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  const git = async (...args: string[]) => (await execute("git", ["-C", repo, ...args])).stdout.trim();
  if (gitProject) {
    const run = execute;
    await run("git", ["-C", repo, "init", "-b", "main"]);
    await run("git", ["-C", repo, "config", "user.name", "Test"]);
    await run("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
    await writeFile(join(repo, "file"), "base\n");
    await run("git", ["-C", repo, "add", "."]);
    await run("git", ["-C", repo, "commit", "-m", "base"]);
  }
  const events = new SessionEventHub();
  const store = new SessionWorktreeStore(join(root, "worktrees.json"));
  await store.initialize();
  const worktrees = new SessionWorktrees(store);
  const createdCwds: string[] = [];
  let next = 0;
  const service = new PiSessionService(events, {
    agentDir: join(root, "agent"), modelRuntime: testModelRuntime, archiveStore: emptyArchiveStore(),
    sessionManager: {
      ...sessionGateway([]),
      create(cwd) {
        createdCwds.push(cwd);
        const id = `session-${String(++next)}`;
        return fakeSessionManager(cwd, { getSessionId: () => id });
      },
    },
    createAgentRuntime: (_create, { sessionManager }) => Promise.resolve(fakeRuntime(sessionManager.getSessionId(), { sessionManager }).runtime),
    sessionWorktrees: worktrees, heartbeatIntervalMs: 60_000,
  });
  const userSessions = new UserSessionWorktrees(worktrees, service);
  const app = Fastify();
  registerSessionWorktreeRoutes(app, userSessions);
  registerSessionRoutes(app, service, events, "", userSessions);
  disposals.push(() => app.close(), () => service.dispose());
  return { root, repo, git, app, service, worktrees, store, createdCwds };
}

describe("user session worktree API", () => {
  it("defaults browser creation to the main checkout without ownership records and dedupes in-flight tokens", async () => {
    const f = await fixture();
    const options = await f.app.inject({ url: `/sessions/worktree-options?cwd=${encodeURIComponent(f.repo)}` });
    expect(options.json()).toMatchObject({ kind: "git", defaultBranch: "main", defaultDestination: "existing-workspace", defaultCwd: f.repo });
    const payload = { cwd: f.repo, startupToken: "browser" };
    const [created, concurrent] = await Promise.all([
      f.app.inject({ method: "POST", url: "/sessions", payload }),
      f.app.inject({ method: "POST", url: "/sessions", payload }),
    ]);
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json<ClientSession>().cwd).toBe(f.repo);
    expect(created.json<ClientSession>().worktree).toBeUndefined();
    expect(concurrent.json<ClientSession>().id).toBe(created.json<ClientSession>().id);
    const repeated = await f.app.inject({ method: "POST", url: "/sessions", payload });
    expect(repeated.json<ClientSession>().id).not.toBe(created.json<ClientSession>().id);
    expect(repeated.json<ClientSession>().cwd).toBe(f.repo);
    expect(f.createdCwds).toEqual([f.repo, f.repo]);
    expect(await f.store.list()).toEqual([]);
    await expect(access(join(f.repo, ".worktrees"))).rejects.toThrow();
    const internal = await f.service.start(f.repo);
    expect(internal.cwd).toBe(f.repo);
  });

  it("uses init.defaultBranch when origin/HEAD is absent", async () => {
    const f = await fixture();
    await f.git("branch", "-m", "trunk");
    await f.git("branch", "main");
    await f.git("config", "init.defaultBranch", "trunk");
    expect(await f.worktrees.options(f.repo)).toMatchObject({ defaultBranch: "trunk", defaultCwd: f.repo });
  });

  it("allows a failed default start to retry without creating ownership records", async () => {
    const f = await fixture();
    const payload = { cwd: f.repo, startupToken: "default-retry" };
    const failed = await f.app.inject({ method: "POST", url: "/sessions", payload: { ...payload, modelSpec: "missing/model" } });
    expect(failed.statusCode).toBe(400);
    const retried = await f.app.inject({ method: "POST", url: "/sessions", payload });
    expect(retried.statusCode, retried.body).toBe(200);
    const subdir = join(f.repo, "subdir");
    await mkdir(subdir);
    const other = await f.app.inject({ method: "POST", url: "/sessions", payload: { ...payload, cwd: subdir } });
    expect(other.statusCode, other.body).toBe(200);
    expect(other.json<ClientSession>().id).not.toBe(retried.json<ClientSession>().id);
    expect(f.createdCwds).toEqual([f.repo, f.repo]);
    expect(await f.store.list()).toEqual([]);
  });

  it("uses origin/HEAD's linked trunk checkout instead of the requested feature checkout", async () => {
    const f = await fixture();
    await f.git("branch", "trunk");
    await f.git("update-ref", "refs/remotes/origin/trunk", "HEAD");
    await f.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
    await f.git("config", "init.defaultBranch", "main");
    await f.git("switch", "-c", "feature");
    const trunk = join(f.root, "trunk");
    await f.git("worktree", "add", trunk, "trunk");
    expect(await f.worktrees.options(f.repo)).toMatchObject({ defaultBranch: "trunk", defaultCwd: trunk });
    const created = await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd: f.repo } });
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json<ClientSession>().cwd).toBe(trunk);
    expect(await f.git("branch", "--show-current")).toBe("feature");
    expect(await f.store.list()).toEqual([]);
  });

  it("prefers the canonical repository checkout when the default branch has multiple checkouts", async () => {
    const f = await fixture();
    const linked = join(f.root, "also-main");
    await f.git("worktree", "add", "--force", linked, "main");
    expect(await f.worktrees.options(linked)).toMatchObject({ defaultBranch: "main", defaultCwd: f.repo });
  });

  it.each(["absent", "prunable", "locked"])("rejects a missing default checkout without side effects (%s)", async (checkout) => {
    const f = await fixture();
    await f.git("switch", "-c", "feature");
    if (checkout !== "absent") {
      const missing = join(f.root, "missing-main");
      await f.git("worktree", "add", missing, "main");
      if (checkout === "locked") await f.git("worktree", "lock", missing);
      await rm(missing, { recursive: true, force: true });
    }
    const before = await f.git("worktree", "list", "--porcelain");
    const branches = await f.git("show-ref", "--heads");
    const exclude = await readFile(join(f.repo, ".git/info/exclude"), "utf8");
    const options = await f.worktrees.options(f.repo);
    expect(options).toMatchObject({ defaultBranch: "main", defaultDestination: "existing-workspace" });
    expect(options).not.toHaveProperty("defaultCwd");
    const created = await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd: f.repo } });
    expect(created.statusCode, created.body).toBe(400);
    expect(created.json<{ error: string }>().error).toMatch(/main.*not checked out.*choose.*existing workspace.*fresh worktree/i);
    expect(await f.store.list()).toEqual([]);
    expect(f.createdCwds).toEqual([]);
    expect(await f.git("worktree", "list", "--porcelain")).toBe(before);
    expect(await f.git("show-ref", "--heads")).toBe(branches);
    expect(await readFile(join(f.repo, ".git/info/exclude"), "utf8")).toBe(exclude);
    await expect(access(join(f.repo, ".worktrees"))).rejects.toThrow();
    const existing = await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd: f.repo, destination: { kind: "existing-workspace" } } });
    expect(existing.statusCode, existing.body).toBe(200);
    expect(existing.json<ClientSession>().cwd).toBe(f.repo);
    const fresh = await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd: f.repo, destination: { kind: "fresh-worktree" } } });
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect(fresh.json<ClientSession>().worktree?.owned).toBe(true);
  });

  it("keeps explicit existing linked workspaces and their subdirectories unchanged", async () => {
    const f = await fixture();
    const linked = join(f.root, "linked");
    await f.git("worktree", "add", "-b", "feature", linked);
    const cwd = join(linked, "subdir");
    await mkdir(cwd);
    const created = await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd, destination: { kind: "existing-workspace" } } });
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json<ClientSession>().cwd).toBe(cwd);
    expect(await f.store.list()).toEqual([]);
    const invalid = await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd, setupId: "not-allowed", destination: { kind: "existing-workspace" } } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "setupId cannot target an existing workspace" });
    expect(f.createdCwds).toEqual([cwd]);
  });

  it("creates explicit fresh worktrees and replays concurrent and completed startup tokens", async () => {
    const f = await fixture();
    const payload = { cwd: f.repo, startupToken: "fresh", destination: { kind: "fresh-worktree" } };
    const [created, concurrent] = await Promise.all([
      f.app.inject({ method: "POST", url: "/sessions", payload }),
      f.app.inject({ method: "POST", url: "/sessions", payload }),
    ]);
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json<ClientSession>().cwd).not.toBe(f.repo);
    expect(created.json<ClientSession>().worktree?.owned).toBe(true);
    expect(concurrent.json<ClientSession>().id).toBe(created.json<ClientSession>().id);
    const repeated = await f.app.inject({ method: "POST", url: "/sessions", payload });
    expect(repeated.json<ClientSession>().id).toBe(created.json<ClientSession>().id);
    expect(f.createdCwds).toHaveLength(1);
    expect(await f.store.list()).toHaveLength(1);
    // A default request never reuses a fresh-worktree ownership record.
    const defaulted = await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd: f.repo, startupToken: "fresh" } });
    expect(defaulted.json<ClientSession>().cwd).toBe(f.repo);
    expect(await f.store.list()).toHaveLength(1);
  });

  it("keeps non-git projects in place and rejects an explicit fresh-worktree request", async () => {
    const f = await fixture(false);
    const created = await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd: f.repo } });
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json<ClientSession>().cwd).toBe(f.repo);
    expect((await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd: f.repo, destination: { kind: "fresh-worktree" } } })).statusCode).toBe(400);
  });

  it("retains a failed first-send setup with its token and retries that same worktree", async () => {
    const f = await fixture();
    await mkdir(join(f.repo, ".forgerie/hooks"), { recursive: true });
    const hook = join(f.repo, ".forgerie/hooks/worktree-post-create");
    await writeFile(hook, "#!/bin/sh\necho broken setup\nexit 9\n", { mode: 0o755 });
    const result = await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd: f.repo, startupToken: "retry-me", destination: { kind: "fresh-worktree" } } });
    expect(result.statusCode).toBe(400);
    expect(f.createdCwds).toEqual([]);
    const [failed] = (await f.app.inject({ url: "/sessions/worktrees" })).json<{ worktrees: SessionWorktreeRecord[] }>().worktrees;
    if (failed === undefined) throw new Error("Expected a failed setup record");
    expect(failed).toMatchObject({ startupToken: "retry-me", setup: { phase: "failed", exitCode: 9 } });
    await rm(hook);
    const retry = await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd: f.repo, setupId: failed.id } });
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json<ClientSession>().cwd).toBe(failed.path);
    expect(await f.store.list()).toHaveLength(1);
    expect(retry.json<ClientSession>().worktree?.setup.phase).toBe("done");
    const duplicate = await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd: f.repo, startupToken: "retry-me", destination: { kind: "fresh-worktree" } } });
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(duplicate.json<ClientSession>().id).toBe(retry.json<ClientSession>().id);
    expect(f.createdCwds).toEqual([failed.path]);
  });

  it("rejects malformed destination and discard confirmations before side effects", async () => {
    const f = await fixture();
    expect((await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd: f.repo, destination: { kind: "anything" } } })).statusCode).toBe(400);
    expect(await f.store.list()).toEqual([]);
    const record = await f.worktrees.create(f.repo);
    expect((await f.app.inject({ method: "POST", url: `/sessions/worktrees/${record.id}/discard`, payload: {} })).statusCode).toBe(409);
    expect((await f.store.require(record.id)).state.kind).toBe("active");
  });
});
