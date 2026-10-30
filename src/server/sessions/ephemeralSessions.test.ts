import { BacklogClaimStore } from "../backlog/backlogClaimStore.js";
import { controlledManagedProcessLauncher } from "../processes/managedProcesses.testSupport.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry } from "@earendil-works/pi-durable";
import { DurableJournalPool } from "./durableJournalPool.js";
import { bindSession } from "./durableSessionBindings.js";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { fauxAssistantMessage, createFauxCore } from "@earendil-works/pi-ai";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { PiSessionService } from "./piSessionService.js";
import { SessionArchiveStore } from "./sessionArchiveStore.js";
import { registerSessionRoutes } from "./sessionRoutes.js";
import { CapturingSessionEventHub, createTestModelRuntime } from "./piSessionService.testSupport.js";
import { durableSessionPaths } from "./durableSessionJournal.js";
import { SessionSearchIndex } from "./sessionSearchIndex.js";
import { assertEphemeralSessionFiles } from "./ephemeralSessionStorage.js";
import { readDurableSessionLocator, writeDurableSessionLocator } from "./durableSessionLocator.js";

const roots: string[] = [];
const services: PiSessionService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.dispose()));
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forgerie-ephemeral-")); roots.push(root);
  const agentDir = join(root, "agent"), cwd = join(root, "project"), dataDir = join(root, "data");
  await Promise.all([agentDir, cwd, dataDir].map(path => mkdir(path, { recursive: true })));
  vi.stubEnv("HOME", root); vi.stubEnv("PI_WEB_DATA_DIR", dataDir);
  const provider = createFauxCore({ provider: "faux", api: "faux" });
  provider.setResponses(Array.from({ length: 30 }, () => fauxAssistantMessage("ephemeral answer")));
  const modelRuntime = await createTestModelRuntime();
  modelRuntime.registerProvider("faux", { api: "faux", apiKey: "test", baseUrl: "http://localhost:0", streamSimple: provider.streamSimple,
    models: [{ id: "faux-1", name: "Faux", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 1000 }] });
  const worktreeStore = new SessionWorktreeStore(join(dataDir, "worktrees.json"));
  await worktreeStore.initialize();
  const worktrees = new SessionWorktrees(worktreeStore);
  const archiveStore = new SessionArchiveStore(join(dataDir, "archived-sessions.json"));
  const processControl = controlledManagedProcessLauncher();
  const logs: Record<string, unknown>[] = [];
  const claims = new BacklogClaimStore(join(dataDir, "claims.json")); await claims.initialize();
  const hubs = new Map<PiSessionService, CapturingSessionEventHub>();
  const reload = () => {
    const events = new CapturingSessionEventHub();
    const gateway = createPiSessionManagerGateway({ agentDir, env: { PI_WEB_DATA_DIR: dataDir }, sessionDirEnvKeys: [] });
    const service = new PiSessionService(events, { agentDir, modelRuntime, sessionManager: gateway, archiveStore, beforeEphemeralDelete: sessionId => claims.releaseSessions([sessionId]), sessionWorktrees: worktrees, logger: { info: details => { logs.push(details); } },
      managedProcesses: { stateDirectory: dataDir, prepareLauncher: () => Promise.resolve(processControl.launcher) }, heartbeatIntervalMs: 60_000 });
    services.push(service); hubs.set(service, events);
    return { service, events, gateway };
  };
  const active = reload();
  async function prompt(service: PiSessionService, ref: { id: string; cwd: string }, text = "private needle") {
    const hub = hubs.get(service);
    const ended = () => hub?.sessionEvents.filter(item => item.sessionId === ref.id && item.event.type === "agent.end").length ?? 0;
    const before = ended();
    await service.prompt(ref, text);
    await vi.waitFor(() => { expect(ended()).toBeGreaterThan(before); }, { timeout: 10_000 });
  }
  return { root, cwd, dataDir, archiveStore, claims, worktrees, worktreeStore, processControl, logs, reload, prompt, ...active };
}

it("creates an ephemeral session through HTTP, validates the flag, and survives service reload", async () => {
  const f = await fixture(); const app = Fastify();
  registerSessionRoutes(app, f.service, f.events, "/api");
  try {
    expect((await app.inject({ method: "POST", url: "/api/sessions", payload: { cwd: f.cwd, ephemeral: "true" } })).statusCode).toBe(400);
    const response = await app.inject({ method: "POST", url: "/api/sessions", payload: { cwd: f.cwd, ephemeral: true, modelSpec: "faux/faux-1" } });
    expect(response.statusCode).toBe(200);
    const session = response.json<{ id: string; cwd: string; path: string; ephemeral: boolean }>();
    expect(session.ephemeral).toBe(true); expect(session.path).toContain("/ephemeral-sessions/");
    // Even an empty chat has a stable, discoverable header across restart.
    await f.service.dispose(); const next = f.reload();
    expect(await next.service.list(f.cwd)).toContainEqual(expect.objectContaining({ id: session.id, ephemeral: true }));
    await next.service.resumeDurableSessions([session]); await f.prompt(next.service, session);
    expect(JSON.stringify(await next.service.messages(session))).toContain("private needle");
    await next.service.dispose(); const again = f.reload();
    expect((await again.service.machineListing()).sessions).toContainEqual(expect.objectContaining({ id: session.id, ephemeral: true }));
    await f.prompt(again.service, session, "after restart");
    expect(JSON.stringify(await again.service.messages(session))).toContain("after restart");
  } finally { await app.close(); }
}, 30_000);

it("excludes ephemeral transcripts and receipts from search and skips manual and open recaps", async () => {
  const f = await fixture(); const session = await f.service.start(f.cwd, { ephemeral: true, initialModelSpec: "faux/faux-1" });
  await f.prompt(f.service, session);
  expect(await f.service.recap(session, "manual")).toEqual({ kind: "skipped" });
  expect(await f.service.recap(session, "open")).toEqual({ kind: "skipped" });
  const index = await SessionSearchIndex.open({ filePath: join(f.root, "search.sqlite"), sessionsDir: f.root, log: () => undefined });
  try {
    await index.scan(); await index.refreshFile(session.path);
    expect(index.search("private needle").hits).toEqual([]);
    expect(index.indexStatus().totalFiles).toBe(0);
  } finally { index.close(); }
}, 20_000);

it("single and bulk close delete the transcript and journal without creating an archive", async () => {
  const f = await fixture();
  const first = await f.service.start(f.cwd, { ephemeral: true, initialModelSpec: "faux/faux-1" });
  await f.prompt(f.service, first);
  expect((await f.service.unreadCatalog()).sessions.some(item => item.sessionId === first.id)).toBe(true);
  const claim = await f.claims.reserve({ projectId: "p", provider: "markdown", itemId: "item", requestId: "r", fingerprint: "f", cwd: f.cwd, repo: f.cwd });
  await f.claims.bind(claim.claimId, first.id, first.cwd);
  await f.service.setTabs(first, ["files"]);
  const owner = await f.service.getManagedProcesses(first.id);
  const process = await owner.start({ id: "proof", command: "cat", cwd: f.cwd });
  await f.service.archive(first);
  expect(await f.claims.list()).toEqual([]);
  expect(f.processControl.stoppedSessions).toContain(first.id);
  await expect(readdir(process.directory)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(first.path)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readdir(durableSessionPaths(first.path).directory)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await f.service.unreadCatalog()).sessions.some(item => item.sessionId === first.id)).toBe(false);
  expect(f.service.notificationCatalog().sessions.some(item => item.sessionId === first.id)).toBe(false);
  const second = await f.service.start(f.cwd, { ephemeral: true, initialModelSpec: "faux/faux-1" });
  const persistent = await f.service.start(f.cwd, { initialModelSpec: "faux/faux-1" });
  await f.prompt(f.service, persistent, "keep me");
  const result = await f.service.archiveMany([second, persistent]);
  expect(result.failures).toEqual([]); expect(result.archivedSessionIds).toEqual(expect.arrayContaining([second.id, persistent.id]));
  expect((await f.archiveStore.list()).map(item => item.sessionId)).toEqual([persistent.id]);
  await expect(readFile(second.path)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await f.service.list(f.cwd)).some(item => item.id === first.id || item.id === second.id)).toBe(false);
}, 30_000);

it("forks into an independent ephemeral journal; deleting it leaves its fork and regular parent resumable", async () => {
  const f = await fixture();
  const parent = await f.service.start(f.cwd, { initialModelSpec: "faux/faux-1" }); await f.prompt(f.service, parent, "regular parent");
  const source = await f.service.start(f.cwd, { ephemeral: true, parentSession: parent.path, initialModelSpec: "faux/faux-1" }); await f.prompt(f.service, source);
  const result = await f.service.runCommand(source, "/clone");
  expect(result.type).toBe("done");
  if (result.type !== "done" || result.session === undefined) throw new Error("Fork did not return a session");
  const fork = result.session;
  expect(fork.ephemeral).toBe(true); expect(fork.path).not.toBe(source.path);
  await f.service.archive(source);
  await f.service.dispose(); const next = f.reload();
  await f.prompt(next.service, fork, "fork survives"); await f.prompt(next.service, parent, "parent survives");
  expect(JSON.stringify(await next.service.messages(fork))).toContain("private needle");
  expect(JSON.stringify(await next.service.messages(parent))).toContain("parent survives");
  await next.service.archive(fork);
  await expect(readFile(fork.path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(parent.path, "utf8")).toContain("regular parent");
}, 40_000);

it("refuses linked or foreign journal paths before deleting files", async () => {
  const f = await fixture(); const session = await f.service.start(f.cwd, { ephemeral: true, initialModelSpec: "faux/faux-1" });
  await f.service.dispose();
  const paths = durableSessionPaths(session.path);
  const locator = await readDurableSessionLocator(paths.directory);
  if (locator === undefined) throw new Error("Missing session locator");
  await writeDurableSessionLocator(paths.directory, { ...locator, databasePath: join(f.root, "outside.sqlite") });
  const next = f.reload();
  await expect(next.service.archive(session)).rejects.toThrow("foreign or shared");
  await expect(readFile(join(f.root, "outside.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(next.service.archiveMany([session])).resolves.toMatchObject({ failures: [expect.objectContaining({ sessionId: session.id })] });
  expect(await readFile(session.path, "utf8")).toContain(session.id);
  expect(f.logs.some(log => log["sessionId"] === session.id && log["err"] instanceof Error)).toBe(true);
  await writeDurableSessionLocator(paths.directory, locator);
  const linked = join(f.dataDir, "ephemeral-sessions", "linked.jsonl"); await symlink(session.path, linked);
  await expect(assertEphemeralSessionFiles(join(f.dataDir, "ephemeral-sessions"), linked, session.id)).rejects.toThrow();
  const outside = join(f.root, "outside.jsonl"); await writeFile(outside, "keep");
  await expect(assertEphemeralSessionFiles(join(f.dataDir, "ephemeral-sessions"), outside, session.id)).rejects.toThrow("outside");
  expect(await readFile(outside, "utf8")).toBe("keep");
}, 20_000);

it("close forgets worktree associations and keeps the checkout and branch, without extra transcript copies", async () => {
  const f = await fixture();
  const run = promisify(execFile);
  const git = async (...args: string[]) => (await run("git", ["-C", f.cwd, ...args])).stdout.trim();
  await git("init", "-b", "main"); await git("config", "user.name", "Test"); await git("config", "user.email", "test@example.invalid");
  await writeFile(join(f.cwd, "file.txt"), "base"); await git("add", "."); await git("commit", "-m", "base");
  const record = await f.worktrees.create(f.cwd);
  const session = await f.service.start(record.path, { ephemeral: true, initialModelSpec: "faux/faux-1" });
  await f.worktrees.attach(record.id, session);
  await f.worktreeStore.saveTranscripts(record.id, [session]);
  expect((await f.worktreeStore.require(record.id)).transcripts[0]?.transcriptPath).toBe(session.path);
  await f.service.archive(session);
  expect(await f.worktreeStore.require(record.id)).toMatchObject({ state: { kind: "active" }, transcripts: [] });
  expect((await f.worktreeStore.require(record.id)).ownerSession).toBeUndefined();
  expect((await f.worktreeStore.require(record.id)).sessionId).toBeUndefined();
  expect(await git("branch", "--list", record.branch)).toContain(record.branch);
  expect(await f.worktrees.cleanupUnused(record.id, () => Promise.resolve(false))).toEqual({ kind: "kept", reason: "retained" });
  const restoredStore = new SessionWorktreeStore(join(f.dataDir, "worktrees.json")); await restoredStore.initialize();
  expect((await restoredStore.require(record.id)).retainAfterSessionClose).toBe(true);
  expect(await readFile(join(record.path, "file.txt"), "utf8")).toBe("base");
  await expect(readdir(join(f.dataDir, "worktree-transcripts"))).rejects.toMatchObject({ code: "ENOENT" });
}, 20_000);

it("refuses deleting a journal that has another logical session binding", async () => {
  const f = await fixture();
  const session = await f.service.start(f.cwd, { ephemeral: true, initialModelSpec: "faux/faux-1" });
  await f.service.dispose();
  const locator = await readDurableSessionLocator(durableSessionPaths(session.path).directory);
  if (locator === undefined) throw new Error("Missing locator");
  const pool = new DurableJournalPool();
  try {
    const handle = await pool.acquire(locator, { models: createModels(), registry: createRegistry() }, BACKGROUND_CONTEXT);
    await handle.harness.commit(tx => bindSession(tx, handle.address.journalId, "another-chat", handle.conversation.id), BACKGROUND_CONTEXT);
    await handle.release(BACKGROUND_CONTEXT);
  } finally { await pool.close(BACKGROUND_CONTEXT); }
  const next = f.reload();
  const result = await next.service.archiveMany([session]);
  expect(result.archivedSessionIds).toEqual([]);
  expect(result.failures).toEqual([expect.objectContaining({ sessionId: session.id, error: "Ephemeral journal is shared or foreign" })]);
  expect(await readFile(session.path, "utf8")).toContain(session.id);
  expect((await readdir(durableSessionPaths(session.path).directory))).toContain("state.sqlite");
}, 20_000);

it("bulk close reports successful permanent deletes even if another ephemeral journal is foreign", async () => {
  const f = await fixture();
  const first = await f.service.start(f.cwd, { ephemeral: true, initialModelSpec: "faux/faux-1" });
  const second = await f.service.start(f.cwd, { ephemeral: true, initialModelSpec: "faux/faux-1" });
  await f.service.dispose();
  const paths = durableSessionPaths(second.path);
  const locator = await readDurableSessionLocator(paths.directory);
  if (locator === undefined) throw new Error("Missing locator");
  await writeDurableSessionLocator(paths.directory, { ...locator, databasePath: durableSessionPaths(first.path).database });
  const next = f.reload();
  const result = await next.service.archiveMany([first, second]);
  // Both fail closed: the second transcript points at the first's database.
  expect(result.archivedSessionIds).toEqual([]);
  expect(result.failures).toHaveLength(2);
  await writeDurableSessionLocator(paths.directory, { ...locator, databasePath: join(f.root, "outside.sqlite") });
  const partial = await next.service.archiveMany([first, second]);
  expect(partial.archivedSessionIds).toEqual([first.id]);
  expect(partial.failures).toEqual([expect.objectContaining({ sessionId: second.id })]);
  await expect(readFile(first.path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(second.path, "utf8")).toContain(second.id);
}, 20_000);

it("forks an ephemeral tree before a user entry and returns its text as a draft", async () => {
  const f = await fixture();
  const source = await f.service.start(f.cwd, { ephemeral: true, initialModelSpec: "faux/faux-1" });
  await f.prompt(f.service, source, "first question"); await f.prompt(f.service, source, "second question");
  const { tree } = await f.service.tree(source);
  const user = tree.nodes.find(node => node.kind === "user" && node.summary.includes("second question"));
  if (user === undefined) throw new Error("Missing user entry");
  const result = await f.service.forkFromTree(source, { entryId: user.id, expectedLeafId: tree.activeLeafId });
  expect(result).toMatchObject({ cancelled: false, promptDraft: "second question", session: { ephemeral: true } });
  if (result.cancelled) throw new Error("Fork missing");
  const history = JSON.stringify(await f.service.messages(result.session));
  expect(history).toContain("first question"); expect(history).not.toContain("second question");
  await f.service.archive(result.session);
  expect(JSON.stringify(await f.service.messages(source))).toContain("second question");
}, 20_000);

it("retains a managed checkout when its last ephemeral occupant was not the worktree owner", async () => {
  const f = await fixture();
  const run = promisify(execFile);
  const git = async (...args: string[]) => (await run("git", ["-C", f.cwd, ...args])).stdout.trim();
  await git("init", "-b", "main"); await git("config", "user.name", "Test"); await git("config", "user.email", "test@example.invalid");
  await writeFile(join(f.cwd, "file.txt"), "base"); await git("add", "."); await git("commit", "-m", "base");
  const record = await f.worktrees.create(f.cwd);
  const owner = await f.service.start(record.path, { initialModelSpec: "faux/faux-1" });
  await f.worktrees.attach(record.id, owner); await f.prompt(f.service, owner, "owner");
  const ephemeral = await f.service.start(record.path, { ephemeral: true, initialModelSpec: "faux/faux-1" });
  await f.service.archive(owner);
  expect((await f.worktreeStore.require(record.id)).archiveCleanup).toEqual({ kind: "retained", reason: "shared" });
  const branchBeforeClose = (await f.worktreeStore.require(record.id)).branch;
  await f.service.archive(ephemeral);
  expect(await f.worktrees.cleanupUnused(record.id, () => Promise.resolve(false))).toEqual({ kind: "kept", reason: "retained" });
  expect(await readFile(join(record.path, "file.txt"), "utf8")).toBe("base");
  expect(await git("branch", "--list", branchBeforeClose)).toContain(branchBeforeClose);
}, 20_000);
