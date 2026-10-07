import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  if (gitProject) {
    const run = promisify(execFile);
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
  return { repo, app, service, worktrees, store, createdCwds };
}

describe("user session worktree API", () => {
  it("defaults browser creation to fresh and keeps explicit opt-out and internal creation in the requested cwd", async () => {
    const f = await fixture();
    const options = await f.app.inject({ url: `/sessions/worktree-options?cwd=${encodeURIComponent(f.repo)}` });
    expect(options.json()).toMatchObject({ kind: "git", defaultBranch: "main", defaultDestination: "fresh-worktree" });
    const created = await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd: f.repo, startupToken: "browser" } });
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json()).toMatchObject({ worktree: { owned: true, state: { kind: "active" }, setup: { phase: "done" } } });
    expect(created.json<ClientSession>().cwd).not.toBe(f.repo);
    const repeated = await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd: f.repo, startupToken: "browser" } });
    expect(repeated.json<ClientSession>().id).toBe(created.json<ClientSession>().id);
    expect(f.createdCwds).toHaveLength(1);
    const optedOut = await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd: f.repo, destination: { kind: "existing-workspace" } } });
    expect(optedOut.statusCode).toBe(200);
    expect(optedOut.json<ClientSession>().cwd).toBe(f.repo);
    const internal = await f.service.start(f.repo);
    expect(internal.cwd).toBe(f.repo);
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
    const result = await f.app.inject({ method: "POST", url: "/sessions", payload: { cwd: f.repo, startupToken: "retry-me" } });
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
