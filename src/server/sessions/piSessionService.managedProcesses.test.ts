import { execFileSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import type { ArchivedSessionRecord } from "./sessionArchiveStore.js";
import { CapturingSessionEventHub, fakeRuntime, fakeSessionManager, runtimeCreator, sessionGateway, sessionRecord, testModelRuntime } from "./piSessionService.testSupport.js";
import { controlledManagedProcessLauncher } from "../processes/managedProcesses.testSupport.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";
import { WorktreeCleanupJob } from "../workspaces/worktreeCleanupJob.js";
import { registerWorktreeCleanupRoutes } from "../workspaces/worktreeCleanupRoutes.js";

const roots: string[] = [];
const services: PiSessionService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(worktree = false) {
  const root = await mkdtemp(join(tmpdir(), "session-process-lifecycle-")); roots.push(root);
  let cwd = root;
  let worktrees: SessionWorktrees | undefined;
  let worktreeId: string | undefined;
  if (worktree) {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git("init", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
    await writeFile(join(root, "base"), "base\n"); git("add", "base"); git("commit", "-qm", "base");
    const store = new SessionWorktreeStore(join(root, "ownership.json")); await store.initialize();
    worktrees = new SessionWorktrees(store, { publish: () => undefined,
      beforeRemoval: (record) => service.prepareWorktreeRemoval(record.path),
      closeManagedProcesses: (record) => service.closeWorktreeManagedProcesses(record) });
    const record = await worktrees.create(root); cwd = record.path; worktreeId = record.id;
  }
  const session = { ...sessionRecord("owner", cwd), path: join(root, "owner.jsonl") };
  await writeFile(session.path, `${JSON.stringify({ type: "session", version: 3, id: session.id, cwd })}\n`);
  if (worktrees !== undefined && worktreeId !== undefined) await worktrees.attach(worktreeId, { id: session.id, cwd, path: session.path });
  const archives: ArchivedSessionRecord[] = [];
  const control = controlledManagedProcessLauncher();
  const runtime = fakeRuntime(session.id, { sessionFile: session.path, sessionManager: fakeSessionManager(cwd, {
    getSessionId: () => session.id, getSessionFile: () => session.path,
  }) });
  const service: PiSessionService = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: root, modelRuntime: testModelRuntime, sessionManager: sessionGateway([session]), createAgentRuntime: runtimeCreator(runtime.runtime),
    ...(worktrees === undefined ? {} : { sessionWorktrees: worktrees }),
    managedProcesses: { stateDirectory: root, prepareLauncher: () => Promise.resolve(control.launcher) },
    archiveStore: {
      list: () => Promise.resolve(archives), get: (id) => Promise.resolve(archives.find((record) => record.sessionId === id)),
      isArchived: (id) => Promise.resolve(archives.some((record) => record.sessionId === id)), restore: () => Promise.resolve(),
      archive: (input) => { const record = { ...input, archivedAt: new Date().toISOString() }; archives.push(record); return Promise.resolve(record); },
      deleteArchived: (id) => { archives.splice(archives.findIndex((record) => record.sessionId === id), 1); return Promise.resolve(); },
    },
  });
  services.push(service);
  const owner = await service.getManagedProcesses(session.id);
  const watchFile = join(root, `${session.id}.process-watches.json`);
  await writeFile(watchFile, "{\"version\":1}");
  const process = await owner.start({ id: "one", command: "cat", cwd });
  return { root, cwd, session, service, owner, process, watchFile, archives, control, worktrees, worktreeId };
}

it.each(["archive", "archiveMany", "archiveTree", "delete"] as const)("%s stops the slice and removes its records and logs", async (action) => {
  const f = await fixture();
  if (action === "archive") await f.service.archive(f.session);
  if (action === "archiveMany") await f.service.archiveMany([f.session]);
  if (action === "archiveTree") await f.service.archiveTree(f.session);
  if (action === "delete") {
    f.archives.push({ sessionId: f.session.id, cwd: f.cwd, archivedAt: new Date().toISOString() });
    expect((await f.service.deleteArchivedMany([f.session])).deletedSessionIds).toEqual([f.session.id]);
  }
  expect(f.control.stoppedSessions).toEqual([f.session.id]);
  expect(f.control.live.size).toBe(0);
  await expect(access(f.process.directory)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(f.watchFile)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["land", "discard", "cleanup-route"] as const)("%s removes the worktree only after stopping managed processes", async (action) => {
  const f = await fixture(true);
  const { worktrees, worktreeId } = f;
  if (worktrees === undefined || worktreeId === undefined) throw new Error("Missing worktree");
  const stop = f.control.launcher.stopSession.bind(f.control.launcher);
  f.control.launcher.stopSession = async (id) => { await access(f.cwd); await stop(id); };
  if (action === "land") expect(await worktrees.land(worktreeId, [])).toMatchObject({ kind: "landed", cleanup: { kind: "done" } });
  if (action === "discard") {
    const preview = await worktrees.discardPreview(worktreeId);
    expect(await worktrees.discard(worktreeId, preview.confirmationToken, [])).toMatchObject({ kind: "discarded", cleanup: { kind: "done" } });
  }
  if (action === "cleanup-route") {
    const job = new WorktreeCleanupJob({ worktrees, inUse: () => Promise.resolve(false) });
    const app = Fastify(); registerWorktreeCleanupRoutes(app, job);
    try {
      const response = await app.inject({ method: "POST", url: "/sessions/worktrees/cleanup", payload: {} });
      expect(response.statusCode).toBe(200);
      expect(response.json<{ removed: unknown[] }>().removed).toHaveLength(1);
    } finally { await app.close(); await job.stop(); }
  }
  expect(f.control.stoppedSessions).toEqual([f.session.id]);
  await expect(access(f.cwd)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(f.process.directory)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(f.watchFile)).rejects.toMatchObject({ code: "ENOENT" });
});

it("daemon disposal leaves durable managed processes and their records running", async () => {
  const f = await fixture(); await f.service.status(f.session); await f.service.dispose();
  expect(f.control.stoppedSessions).toEqual([]);
  expect(f.control.live.has("owner/one")).toBe(true);
  await access(join(f.process.directory, "command.json"));
  await access(f.watchFile);
});

it("reconciles an archived owner at startup, including its saved watches", async () => {
  const f = await fixture();
  f.archives.push({ sessionId: f.session.id, cwd: f.cwd, originalPath: f.session.path, archivedAt: new Date().toISOString() });
  await f.service.initializeManagedProcesses();
  expect(f.control.stoppedSessions).toEqual([f.session.id]);
  await expect(access(f.process.directory)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(f.watchFile)).rejects.toMatchObject({ code: "ENOENT" });
});

it("fails archive without deleting managed process evidence or watches when slice stop fails", async () => {
  const f = await fixture();
  f.control.launcher.stopSession = () => Promise.reject(new Error("manager unavailable"));
  await expect(f.service.archive(f.session)).rejects.toThrow("manager unavailable");
  expect(f.archives).toEqual([]);
  expect(f.control.live.has("owner/one")).toBe(true);
  await access(join(f.process.directory, "command.json"));
  await access(f.watchFile);
});
