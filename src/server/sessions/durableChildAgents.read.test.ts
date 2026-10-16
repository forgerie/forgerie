import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxToolCall, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { AssistantEntry, Harness, ToolTask, UsageDoc, createRegistry, defineDoc, defineTask, type ConversationId, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { expect, it } from "vitest";
import { CHILD_AGENTS_DOC_KIND, CHILD_QUESTIONS_DOC_KIND } from "./durableChildAgents.js";
import { registerDurableChildRoutes } from "./durableChildRoutes.js";
import { acquireDurableOwnership } from "./durableOwnership.js";
import { readSavedChild } from "./durableChildSavedReads.js";
import { DurableSessionJournal, durableSessionPaths } from "./durableSessionJournal.js";
import { writeDurableSessionLocator } from "./durableSessionLocator.js";
import { bindSession } from "./durableSessionBindings.js";
import { PiSessionService } from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { CapturingSessionEventHub, testModelRuntime } from "./piSessionService.testSupport.js";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";

// defineDoc needs JSON-compatible aliases rather than interfaces.
/* eslint-disable @typescript-eslint/consistent-type-definitions */
type ChildDoc = { agents: Record<string, { conversationId: ConversationId; reported: number[]; agent: null; createdAt: number; worktreeId: string }>; reporters: Record<string, TaskId> };
type QuestionDoc = { items: Record<string, { child: ConversationId; childName: string; question: string; answer: null; askedAt: number }> };
/* eslint-enable @typescript-eslint/consistent-type-definitions */
const Children = defineDoc<ChildDoc>({ kind: CHILD_AGENTS_DOC_KIND, version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ agents: {}, reporters: {} }) });
const Questions = defineDoc<QuestionDoc>({ kind: CHILD_QUESTIONS_DOC_KIND, version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ items: {} }) });
const Reporter = defineTask({ name: "forgerie.child-reporter", version: 1,
  initial: () => ({ phase: "retry", attempt: 1, error: "overloaded", until: 9999999999999 }),
  phases: { retry: () => { throw new Error("A read must not run the reporter"); } },
  abort: () => { throw new Error("A read must not abort the reporter"); } });

it("lists persisted child rows and transcripts over HTTP without opening or resuming a session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-child-row-read-"));
  const databasePath = join(directory, "state.sqlite");
  const models = createModels();
  const provider = fauxProvider(); models.setProvider(provider.provider);
  const registry = createRegistry();
  const harness = await Harness.open(await openNodeSqliteStorage(databasePath), { models, registry }, context);
  const parent = await harness.root(context);
  const child = await harness.commit(async tx => {
    await bindSession(tx, "test", "saved", parent.id);
    const child = await tx.createConversation({ ownership: { kind: "ownerless" } });
    const entry = await tx.appendEntry(AssistantEntry, child.id, { model: [fauxAssistantMessage([fauxToolCall("write", { content: "private secret" })], { timestamp: 123, stopReason: "toolUse" })] });
    const call = entry.model?.[0];
    if (call?.role !== "assistant" || call.content[0]?.type !== "toolCall") throw new Error("Invalid fixture call");
    await tx.createTask(ToolTask, { assistant: entry.id, callId: call.content[0].id }, { conversationId: child.id, ownership: { kind: "conversation" } });
    const reporter = await tx.createTask(Reporter, { conversationId: child.id }, { conversationId: parent.id, ownership: { kind: "conversation" } });
    const doc = await tx.doc(Children, parent.id);
    doc.agents["writer"] = { conversationId: child.id, reported: [], agent: null, createdAt: 1, worktreeId: "child-worktree" };
    doc.reporters["report"] = reporter;
    (await tx.doc(Questions, parent.id)).items["q:1"] = { child: child.id, childName: "writer", question: "Proceed?", answer: null, askedAt: 2 };
    // Missing ledger is not a zero estimate.
    await tx.retireDoc(UsageDoc, child.id);
    return child;
  }, context);
  await harness.close(context);
  const sessionFile = join(directory, "saved.jsonl");
  await writeFile(sessionFile, JSON.stringify({ type: "session", version: 3, id: "saved", cwd: directory, timestamp: "2026-01-01T00:00:00.000Z" }) + "\n");
  const address = { databasePath, journalId: "test", sessionId: "saved", conversationId: parent.id };
  await writeDurableSessionLocator(durableSessionPaths(sessionFile).directory, address);
  const store = new SessionWorktreeStore();
  await store.add({ id: "child-worktree", repo: directory, path: join(directory, "removed"), branch: "child-writer", defaultBranch: "main", sourceCommit: "abc", childOwner: { id: "saved", cwd: directory },
    renamed: true, setup: { phase: "done", log: "" }, state: { kind: "landed", sha: "abc", at: "2026-01-01" }, cleanup: { kind: "done" }, transcripts: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  let runtimeOpens = 0;
  const gateway = createPiSessionManagerGateway({ agentDir: directory, env: {}, sessionDirEnvKeys: [] });
  gateway.resolveSessionFile = (cwd, id) => Promise.resolve(cwd === directory && id === "saved" ? { id, cwd, path: sessionFile } : undefined);
  const service = new PiSessionService(new CapturingSessionEventHub(), { agentDir: directory, modelRuntime: testModelRuntime,
    sessionManager: gateway,
    sessionWorktrees: new SessionWorktrees(store, { publish: () => undefined }),
    createAgentRuntime: () => { runtimeOpens++; throw new Error("Reads must not open a runtime"); }, heartbeatIntervalMs: 60_000 });
  const app = Fastify(); registerDurableChildRoutes(app, service);
  try {
    const base = `/sessions/saved/children`;
    const query = `?${new URLSearchParams({ cwd: directory })}`;
    const response = await app.inject(base + query);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ name: "writer", conversationId: Number(child.id), agent: null, createdAt: 1, busy: true,
      costUsd: null, lastTool: { name: "write", at: 123 }, retry: { attempt: 1, max: 3, error: "overloaded", until: 9999999999999 },
      questions: [{ questionId: "q:1", question: "Proceed?", askedAt: 2 }],
      worktree: { path: join(directory, "removed"), branch: "child-writer", repo: directory, defaultBranch: "main", cleanup: { kind: "done" }, state: "landed", ahead: 0, dirty: false } }]);
    expect(response.body).not.toContain("private secret");
    expect((await app.inject(`${base}/${String(child.id)}/messages${query}`)).statusCode).toBe(200);
    expect((await app.inject(`${base}/999/messages${query}`)).statusCode).toBe(404);
    expect((await app.inject(`/sessions/other/children${query}`)).statusCode).toBe(404);
    expect(runtimeOpens).toBe(0);
    expect(provider.state.callCount).toBe(0);
    const stored = await openNodeSqliteStorage(databasePath);
    try {
      const tasks = await stored.scanTasks({}, 10, undefined, context);
      expect(tasks.items).toHaveLength(2);
      expect(tasks.items.every(task => task.state.status === "pending")).toBe(true);
    } finally { await stored.close(context); }
    await writeDurableSessionLocator(durableSessionPaths(sessionFile).directory, { ...address, journalId: "foreign" });
    const foreign = await app.inject(base + query);
    expect(foreign.statusCode).toBe(500);
    expect(foreign.json()).toEqual({ error: "Invalid or foreign saved child session bindings" });
    await writeDurableSessionLocator(durableSessionPaths(sessionFile).directory, address);
    const ownership = await acquireDurableOwnership(databasePath);
    try {
      const locked = await app.inject(base + query);
      expect(locked.statusCode).toBe(500);
      expect(locked.json<{ error: string }>().error).toContain("ownership lost or already held");
    } finally { await ownership.release(); }
  } finally { await app.close(); await service.dispose(); await rm(directory, { recursive: true, force: true }); }
});

it("borrows an owned family's storage and selects the committed binding rather than a stale locator", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-child-row-owned-read-"));
  const databasePath = join(directory, "state.sqlite");
  const sessionFile = join(directory, "saved.jsonl");
  const owner = await DurableSessionJournal.pool.acquire({ databasePath, sessionId: "saved", create: {} }, { models: createModels(), registry: createRegistry() }, context);
  try {
    await writeDurableSessionLocator(durableSessionPaths(sessionFile).directory, owner.address);
    const selected = await owner.harness.commit(async tx => {
      const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
      await bindSession(tx, owner.address.journalId, "saved", conversation.id);
      return conversation.id;
    }, context);
    expect(await readSavedChild(sessionFile, "saved", async (storage, parent) => (await storage.conversation(parent, context))?.id)).toBe(selected);
    expect((await owner.harness.inspect(context)).scheduling).toBe("paused");
    await expect(readSavedChild(sessionFile, "other", () => Promise.resolve(null))).rejects.toThrow("Foreign saved child session locator");
  } finally { await owner.release(context); await rm(directory, { recursive: true, force: true }); }
});
