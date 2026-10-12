import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRegistry, defineDoc, ROOT_CONVERSATION_ID, type TaskId, type TaskState } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, describe, expect, it } from "vitest";
import { durableSessionNeedsRecovery, recoverDurableSessions } from "./durableSessionRecovery.js";
import { DurableSessionJournal, durableSessionPaths } from "./durableSessionJournal.js";
import { acquireDurableOwnership } from "./durableOwnership.js";
import { WORKFLOW_DOC_KIND } from "./durableWorkflowRuns.js";
import { writeDurableSessionLocator } from "./durableSessionLocator.js";
import { DurableJournalPool } from "./durableJournalPool.js";
import { createDurableNativeHistory, durableEntryPresentationId } from "./durableNativeHistory.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture(activeWorkflow = false) {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-recovery-state-"));
  directories.push(directory);
  const manager = SessionManager.create(directory, directory);
  manager.appendMessage({ role: "user", content: "Prior work", timestamp: 1 });
  manager.appendMessage(fauxAssistantMessage("Done"));
  const journal = await DurableSessionJournal.open({ manager, models: createModels(), registry: createRegistry(), agent: {} });
  try {
    if (activeWorkflow) {
      const workflow = defineDoc({ kind: WORKFLOW_DOC_KIND, version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ active: "waiting-at-stop" }) });
      await journal.conversation.commit((tx) => tx.doc(workflow, journal.conversation.id), context);
    }
  } finally { await journal.close(); }
  const file = manager.getSessionFile();
  if (file === undefined) throw new Error("Fixture must persist");
  return { directory, file, database: durableSessionPaths(file).database };
}

describe("Durable recovery discovery", () => {
  it("does not create a journal for a legacy session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgerie-recovery-legacy-"));
    directories.push(directory);
    const file = join(directory, "legacy.jsonl");
    await writeFile(file, "Legacy history\n");
    expect(await durableSessionNeedsRecovery(file)).toBe(false);
    expect(await readFile(file, "utf8")).toBe("Legacy history\n");
    await expect(stat(durableSessionPaths(file).directory)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("leaves a completed journal and its transcript idle", async () => {
    const { file } = await fixture();
    const before = await readFile(file, "utf8");
    expect(await durableSessionNeedsRecovery(file)).toBe(false);
    expect(await readFile(file, "utf8")).toBe(before);
  });
  it.each(["pending", "running", "waiting", "completing", "terminal"] as const)("discovers %s tasks through public storage reads", async (status) => {
    const { file, database } = await fixture();
    const storage = await openNodeSqliteStorage(database);
    try {
      const state: TaskState<null, null> = status === "terminal" || status === "completing"
        ? { status, outcome: { status: "completed", result: null } }
        : status === "waiting" ? { status, checkpoint: null, on: [], policy: "allSettled" }
          : { status, checkpoint: null };
      const base = { id: await storage.mintId<TaskId<null>>(), conversationId: ROOT_CONVERSATION_ID,
        kind: "test.saved-task", version: 1, input: null, background: false, abortRequested: false };
      const value = state.status === "terminal" || state.status === "completing" ? { ...base, state } : { ...base, state, memos: {} };
      await storage.commit([{ type: "task", value }], context);
    } finally { await storage.close(context); }
    expect(await durableSessionNeedsRecovery(file)).toBe(status !== "terminal");
  });
  it("discovers a queued passive write even without a live task", async () => {
    const { file, database } = await fixture();
    const storage = await openNodeSqliteStorage(database);
    try {
      await storage.commit([{ type: "submission", value: { id: await storage.mintId(), conversationId: ROOT_CONVERSATION_ID, type: "write", status: "queued" } }], context);
    } finally { await storage.close(context); }
    expect(await durableSessionNeedsRecovery(file)).toBe(true);
  });
  it("discovers a workflow at a user stop without a live task or an external index", async () => {
    const { file } = await fixture(true);
    expect(await durableSessionNeedsRecovery(file)).toBe(true);
  });
  it("follows selected and retained bindings to workflows outside the reserved root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgerie-recovery-fork-"));
    directories.push(directory);
    const pool = new DurableJournalPool();
    const options = { models: createModels(), registry: createRegistry() };
    const workflow = defineDoc({ kind: WORKFLOW_DOC_KIND, version: 1, scope: "conversation", history: "latest", fork: "initial", initial: (): { active: string | null } => ({ active: null }) });
    try {
      const parent = await pool.acquire({ databasePath: join(directory, "state.sqlite"), sessionId: "parent", create: {} }, options, context);
      const anchor = (await parent.conversation.entries({}, 1, undefined, context)).items[0];
      if (anchor === undefined) throw new Error("Missing origin");
      const history = createDurableNativeHistory(parent, { acquire: (address, ctx) => pool.acquireCandidate(address, options, ctx) });
      const fork = (await history.fork(durableEntryPresentationId(parent.address.journalId, anchor, 0), "at", "fork", context)).handle;
      await fork.conversation.commit(async (tx) => { (await tx.doc(workflow, fork.conversation.id)).active = "waiting-at-stop"; }, context);
      await parent.release(context);
      await fork.release(context);
      expect(await durableSessionNeedsRecovery(fork.address)).toBe(true);
      expect(await durableSessionNeedsRecovery(parent.address)).toBe(false);
      const report = await recoverDurableSessions({
        catalog: () => Promise.resolve([{ id: "parent", cwd: directory, path: "unused", address: parent.address }, { id: "fork", cwd: directory, path: "unused", address: fork.address }]),
        available: () => Promise.resolve(true), stopped: () => false, reopen: () => Promise.resolve(),
      });
      expect(report).toEqual({ resumed: ["fork"], failed: [] });
    } finally { await pool.close(context); }
  });
  it("recovers a fork from catalog paths whose directories contain only locators", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgerie-recovery-paths-"));
    directories.push(directory);
    const pool = new DurableJournalPool();
    const options = { models: createModels(), registry: createRegistry() };
    const workflow = defineDoc({ kind: WORKFLOW_DOC_KIND, version: 1, scope: "conversation", history: "latest", fork: "initial", initial: (): { active: string | null } => ({ active: null }) });
    try {
      const parent = await pool.acquire({ databasePath: join(directory, "state.sqlite"), sessionId: "parent", create: {} }, options, context);
      const anchor = (await parent.conversation.entries({}, 1, undefined, context)).items[0];
      if (anchor === undefined) throw new Error("Missing origin");
      const history = createDurableNativeHistory(parent, { acquire: (address, ctx) => pool.acquireCandidate(address, options, ctx) });
      const fork = (await history.fork(durableEntryPresentationId(parent.address.journalId, anchor, 0), "at", "fork", context)).handle;
      await fork.conversation.commit(async (tx) => { (await tx.doc(workflow, fork.conversation.id)).active = "waiting-at-stop"; }, context);
      const parentPath = join(directory, "parent.jsonl");
      const forkPath = join(directory, "fork.jsonl");
      await writeDurableSessionLocator(durableSessionPaths(parentPath).directory, parent.address);
      await writeDurableSessionLocator(durableSessionPaths(forkPath).directory, fork.address);
      await parent.release(context);
      await fork.release(context);
      await expect(stat(durableSessionPaths(forkPath).database)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await durableSessionNeedsRecovery(forkPath)).toBe(true);
      expect(await durableSessionNeedsRecovery(parentPath)).toBe(false);
      const report = await recoverDurableSessions({
        catalog: () => Promise.resolve([{ id: "parent", cwd: directory, path: parentPath }, { id: "fork", cwd: directory, path: forkPath }]),
        available: () => Promise.resolve(true), stopped: () => false, reopen: () => Promise.resolve(),
      });
      expect(report).toEqual({ resumed: ["fork"], failed: [] });
    } finally { await pool.close(context); }
  });
  it("reports ownership conflicts instead of opening another owner's journal", async () => {
    const { file, database } = await fixture();
    const owner = await acquireDurableOwnership(database);
    try { await expect(durableSessionNeedsRecovery(file)).rejects.toThrow("ownership lost or already held"); }
    finally { await owner.release(); }
    expect(await durableSessionNeedsRecovery(file)).toBe(false);
  });
  it("reports corrupt storage without overwriting it", async () => {
    const { file, database } = await fixture();
    await writeFile(database, "Not a database");
    await expect(durableSessionNeedsRecovery(file)).rejects.toThrow();
    expect(await readFile(database, "utf8")).toBe("Not a database");
  });
});

describe("startup recovery orchestration", () => {
  it("isolates a journal failure, skips unavailable sessions, and repairs settled accounting", async () => {
    const opened: string[] = [];
    const scanned: string[] = [];
    const sessions = ["broken", "parent", "archived", "idle"].map((id) => ({ id, cwd: "/workspace", path: id }));
    const report = await recoverDurableSessions({
      catalog: () => Promise.resolve(sessions), repair: [{ id: "receipt", cwd: "/workspace" }], stopped: () => false,
      available: (ref) => Promise.resolve(ref.id !== "archived"),
      needsRecovery: (path) => {
        scanned.push(path);
        if (path === "broken") return Promise.reject(new Error("Corrupt journal"));
        return Promise.resolve(path === "parent");
      },
      reopen: (ref) => { opened.push(ref.id); return Promise.resolve(); },
    });
    expect(opened.sort()).toEqual(["parent", "receipt"]);
    expect(scanned.sort()).toEqual(["broken", "idle", "parent"]);
    expect(report.resumed.sort()).toEqual(opened);
    expect(report.failed).toEqual([{ id: "broken", error: "Corrupt journal" }]);
  });
  it("does not reopen work if shutdown starts during journal inspection", async () => {
    let stopping = false;
    const opened: string[] = [];
    expect(await recoverDurableSessions({
      catalog: () => Promise.resolve([{ id: "pending", cwd: "/workspace", path: "pending" }]),
      stopped: () => stopping, available: () => Promise.resolve(true),
      needsRecovery: () => { stopping = true; return Promise.resolve(true); },
      reopen: (ref) => { opened.push(ref.id); return Promise.resolve(); },
    })).toEqual({ resumed: [], failed: [] });
    expect(opened).toEqual([]);
  });
  it("bounds concurrent opens and deduplicates accounting repair references", async () => {
    let inFlight = 0;
    let peak = 0;
    const sessions = Array.from({ length: 12 }, (_, id) => ({ id: String(id), cwd: "/workspace", path: String(id) }));
    const report = await recoverDurableSessions({
      catalog: () => Promise.resolve(sessions), repair: sessions.slice(0, 1), stopped: () => false,
      available: () => Promise.resolve(true), needsRecovery: () => Promise.resolve(true),
      reopen: async () => { peak = Math.max(peak, ++inFlight); await new Promise<void>((resolve) => { setTimeout(resolve, 5); }); inFlight--; },
    });
    expect(peak).toBe(4);
    expect(report.resumed).toHaveLength(12);
    expect(new Set(report.resumed).size).toBe(12);
  });
});
