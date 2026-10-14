import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { AssistantEntry, Harness, GenerationTask, createRegistry, defineDoc, defineExtension, defineTask, defineTool, type ConversationId, type EntryId, type TaskId, type TaskInspection, type TaskGraph, type Tx } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";
import { Type } from "typebox";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { childWorkIsLive, workingChildCount } from "./durableChildAgents.js";
import { taskActivitySchema } from "../../shared/durableTaskActivity.js";
import { readTaskActivity, taskFamily, watchTaskActivity } from "./durableTaskActivity.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const anchor = defineTask<null, { phase: "hold" }, null>({ name: "forgerie.child-anchor", version: 1, initial: () => ({ phase: "hold" }), phases: { hold: () => Promise.resolve() }, abort: () => Promise.resolve() });
const work = GenerationTask;
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-task-activity-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const registry = createRegistry();
  registry.install(defineExtension({ name: "activity-tests", tasks: [anchor] }));
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, "state.sqlite")), { models: createModels(), registry }, context);
  cleanups.push(() => harness.close(context));
  const parent = await harness.root(context);
  return { harness, parent };
}

it("projects only live tasks owned by this parent, not another root or its children", async () => {
  const { harness, parent } = await fixture();
  const other = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
  await parent.commit(tx => tx.createTask(work, {}, { ownership: { kind: "conversation" } }), context);
  await other.commit(tx => tx.createTask(work, {}, { ownership: { kind: "conversation" } }), context);
  const publications: unknown[] = [];
  const unsubscribe = harness.subscribeCommits(publication => { publications.push(publication); });
  const result = await readTaskActivity(harness, parent.id, context);
  unsubscribe();
  expect(publications).toEqual([]);
  expect(result).toMatchObject({ kind: "ready", parentConversationId: parent.id, backgroundAgents: 0, agents: [], tasks: [{ label: "Answering your message", status: "pending", scheduler: "ready", startedAt: null, restart: "resumes" }] });
  expect(result.tasks).toHaveLength(1);
  expect(JSON.stringify(result)).not.toMatch(/"(?:input|checkpoint|arguments|memos|provenance)"/);
});

// Seed persisted records before opening the real scheduler, including older-version states.
async function seedConversation(storage: MemoryStorage) {
  const id = await storage.mintId<ConversationId>();
  await storage.commit([{ type: "conversation", value: { id } }], context);
  return id;
}
async function seedTask(storage: MemoryStorage, conversationId: ConversationId, kind: string, options: Partial<Pick<TaskInspection["record"], "state" | "owner" | "version" | "input" | "startedAt" | "background">> = {}) {
  const id = await storage.mintId<TaskId<JsonValue>>();
  const { state: savedState, ...fields } = options;
  const state = savedState ?? { status: "pending", checkpoint: { phase: "hold", private_checkpoint: "NEVER-PUBLISH" } };
  const base = { id, conversationId, kind, version: 1, input: { private_input: "NEVER-PUBLISH" }, background: false, abortRequested: false, ...fields };
  const value: TaskInspection["record"] = state.status === "terminal" || state.status === "completing" ? { ...base, state } : { ...base, state };
  await storage.commit([{ type: "task", value }], context);
  return id;
}
function taskDefinition(name: string, version = 1) {
  return defineTask<null, { phase: "hold" }, null>({ name, version, initial: () => ({ phase: "hold" }),
    phases: { hold: async (_task, _runtime, ctx) => { await sleep(60_000, undefined, { signal: ctx.abortSignal }); } },
    abort: (task, runtime, ctx) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx) });
}
async function openSeed(storage: MemoryStorage, definitions = [taskDefinition("custom.work")]) {
  const registry = createRegistry();
  registry.install(defineExtension({ name: "seeded-tasks", tasks: definitions }));
  const harness = await Harness.open(storage, { models: createModels(), registry }, context);
  cleanups.push(() => harness.close(context));
  return { harness, registry };
}

it("classifies persisted pending, waiting, completing, blocked and unknown work without exposing saved records", async () => {
  const storage = new MemoryStorage();
  const parent = await seedConversation(storage);
  const pending = await seedTask(storage, parent, "custom.work");
  const terminal = await seedTask(storage, parent, "custom.work", { state: { status: "terminal", outcome: { status: "completed", result: null } } });
  const waiting = await seedTask(storage, parent, "custom.work", { state: { status: "waiting", checkpoint: { phase: "hold" }, on: [pending, terminal], policy: "allSettled" }, startedAt: 123 });
  const completing = await seedTask(storage, parent, "custom.work", { state: { status: "completing", outcome: { status: "completed", result: null } } });
  await seedTask(storage, parent, "custom.work", { owner: completing });
  const tooOld = await seedTask(storage, parent, "forgerie.trigger", { version: 2 });
  const missing = await seedTask(storage, parent, "missing");
  const migration = await seedTask(storage, parent, "migration");
  const approved = await seedTask(storage, parent, "forgerie.gated-action-run", { state: { status: "pending", checkpoint: { phase: "unknown" } } });
  const { harness } = await openSeed(storage, [taskDefinition("custom.work"), taskDefinition("forgerie.trigger"), taskDefinition("migration", 2), taskDefinition("forgerie.gated-action-run")]);
  const result = await readTaskActivity(harness, parent, context);
  const row = (id: TaskId) => result.tasks.find(task => task.id === id);
  expect(row(pending)).toMatchObject({ status: "pending", scheduler: "ready", startedAt: null, label: "Working", restart: "unknown" });
  expect(row(terminal)).toBeUndefined();
  expect(row(waiting)).toMatchObject({ status: "waiting", waitingOn: 1, startedAt: 123 });
  expect(row(completing)).toMatchObject({ status: "completing", waitingOn: 0 });
  expect(row(tooOld)).toMatchObject({ status: "blocked", blockedReason: "task_too_old", scheduler: "blocked: task_too_old", restart: "blocked" });
  expect(row(missing)).toMatchObject({ blockedReason: "missing_task" });
  expect(row(migration)).toMatchObject({ blockedReason: "migration_failed" });
  expect(row(approved)).toMatchObject({ label: "Running an approved action", restart: "stops" });
  expect(result.tasks.find(task => task.owner === completing)).toBeDefined();
  expect(JSON.stringify(result)).not.toMatch(/private_|NEVER-PUBLISH|"input"|"checkpoint"|"arguments"/);
  expect(taskActivitySchema.safeParse({ ...result, input: "private" }).success).toBe(false);
});

it("shows actual running tasks, and keeps restored running records pending without inventing a start time", async () => {
  const storage = new MemoryStorage();
  const parent = await seedConversation(storage);
  const id = await seedTask(storage, parent, "custom.work", { state: { status: "running", checkpoint: { phase: "hold" } } });
  const { harness } = await openSeed(storage);
  expect((await readTaskActivity(harness, parent, context)).tasks[0]).toMatchObject({ id, status: "pending", startedAt: null });
  harness.resume();
  await vi.waitFor(async () => { expect((await readTaskActivity(harness, parent, context)).tasks[0]).toMatchObject({ id, status: "running", scheduler: "running" }); });
});

it("keeps a child's work after its anchor is terminal and isolates sibling roots, history forks and ownerless control tasks", async () => {
  const storage = new MemoryStorage();
  const parent = await seedConversation(storage);
  const other = await seedConversation(storage);
  const anchorId = await seedTask(storage, parent, "forgerie.child-anchor", { state: { status: "terminal", outcome: { status: "completed", result: null } } });
  const child = await storage.mintId<ConversationId>();
  const sibling = await storage.mintId<ConversationId>();
  const fork = await storage.mintId<ConversationId>();
  const at = await storage.mintId<EntryId>();
  const otherAnchor = await seedTask(storage, other, "forgerie.child-anchor");
  await storage.commit([
    { type: "conversation", value: { id: child, owner: { conversationId: parent, taskId: anchorId } } },
    { type: "conversation", value: { id: sibling, owner: { conversationId: other, taskId: otherAnchor } } },
    { type: "conversation", value: { id: fork, parent: { conversationId: parent, at } } },
  ], context);
  const ownTask = await seedTask(storage, child, "pi.generation", { input: {}, state: { status: "pending", checkpoint: { phase: "prepare", attempt: 0 } } });
  await seedTask(storage, sibling, "custom.work");
  await seedTask(storage, fork, "custom.work");
  await seedTask(storage, other, "forgerie.workflow-cancel");
  const reporter = await seedTask(storage, parent, "forgerie.child-reporter", { background: true, input: { conversationId: child, name: "ui", message: "PRIVATE MESSAGE", followUp: false } });
  const { harness } = await openSeed(storage, [anchor, taskDefinition("custom.work"), taskDefinition("forgerie.child-reporter"), taskDefinition("forgerie.workflow-cancel")]);
  const children = defineDoc<{ agents: Record<string, { conversationId: ConversationId; agent: null; reported: EntryId[]; createdAt: number; agentFile: { path: string; sha256: string } }>; reporters: Record<string, TaskId> }>({ kind: "forgerie.durable-children", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ agents: {}, reporters: {} }) });
  await harness.commit(async tx => { (await tx.doc(children, parent)).agents["ui"] = { conversationId: child, agent: null, reported: [], createdAt: 1, agentFile: { path: "PRIVATE-PROVENANCE", sha256: "secret" } }; }, context);
  const result = await readTaskActivity(harness, parent, context);
  expect(result.agents).toEqual([{ conversationId: child, name: "ui", taskId: null }]);
  expect(result.backgroundAgents).toBe(1);
  expect(result.tasks.map(task => task.id).sort()).toEqual([ownTask, reporter].sort());
  expect(result.tasks.find(task => task.id === ownTask)).toMatchObject({ label: "Answering", owner: null, group: "background" });
  expect(result.tasks.find(task => task.id === reporter)).toMatchObject({ label: "Report back to this session", agentConversationId: child, owner: null, group: "background" });
  const graph = (await harness.taskGraph(context));
  try {
    const family = await taskFamily(harness, parent, Object.values(graph.value.tasks).map(task => task.conversationId), context);
    expect(workingChildCount(graph.value, parent, family)).toBe(result.backgroundAgents);
    expect(childWorkIsLive(graph.value, parent, family)).toBe(true);
    const otherFamily = await taskFamily(harness, fork, Object.values(graph.value.tasks).map(task => task.conversationId), context);
    expect(workingChildCount(graph.value, fork, otherFamily)).toBe(0);
    expect(childWorkIsLive({ tasks: Object.fromEntries(Object.entries(graph.value.tasks).filter(([, task]) => task.conversationId !== fork)) }, fork, otherFamily)).toBe(false);
  } finally { graph.dispose(); }
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|agentFile|sha256|"input"|"checkpoint"|"arguments"/);
});

it("uses the assistant's matching tool call, allowlists subjects, and requires both resolved and saved safe replay", async () => {
  const storage = new MemoryStorage();
  const parent = await seedConversation(storage);
  async function tool(name: string, args: Record<string, JsonValue>, replay: "safe" | "unsafe" = "safe") {
    const assistant = await storage.mintId<EntryId>();
    const call = fauxToolCall(name, args);
    await storage.commit([{ type: "entry", value: { id: assistant, conversationId: parent, kind: AssistantEntry.kind,
      model: [fauxAssistantMessage([fauxToolCall("private_tool", { input: "PRIVATE-ARGUMENT" }), call])] } }], context);
    return seedTask(storage, parent, "pi.tool", { input: { assistant, callId: call.id }, state: { status: "running", checkpoint: { phase: "execute", replay, arguments: args } } });
  }
  const safe = await tool("read", { path: "src/private.ts", content: "PRIVATE-CONTENT", password: "PRIVATE-PASSWORD" });
  const savedUnsafe = await tool("read", { path: "unsafe.txt" }, "unsafe");
  const command = await tool("bash", { command: "KEY='secret value' run --token alpha --password=beta --secret 'gamma delta' --key=epsilon -p zeta\nPRIVATE-SECOND-LINE" });
  const quoted = await tool("bash", { command: "KEY='PRIVATE ONE'PRIVATE-TWO run --token \"PRIVATE THREE\"PRIVATE-FOUR -p 'PRIVATE FIVE\nPRIVATE SIX'" });
  const longPath = await tool("find", { path: "x".repeat(150), pattern: "PRIVATE-PATTERN" });
  const custom = await tool("custom", { command: "PRIVATE-COMMAND", path: "PRIVATE-PATH" }, "unsafe");
  const { harness, registry } = await openSeed(storage);
  const names = ["read", "bash", "find", "custom"];
  function tools(readSafe: boolean) {
    return defineExtension({ name: "activity-tool-policy", tools: names.map(name => defineTool({ name, description: name, parameters: Type.Object({}), replay: name === "read" && !readSafe || name === "custom" ? "unsafe" : "safe", execute: () => Promise.resolve({ content: [] }) })) });
  }
  registry.install(tools(true));
  const conversation = await harness.conversation(parent, context);
  if (conversation === undefined) throw new Error("Missing seeded conversation");
  await conversation.configure({ extensions: [tools(true)] }, context);
  const result = await readTaskActivity(harness, parent, context);
  const row = (id: TaskId) => result.tasks.find(task => task.id === id);
  expect(row(safe)).toMatchObject({ label: "Read", subject: "src/private.ts", tool: { name: "read", replay: "safe" }, restart: "resumes", startedAt: null });
  expect(row(savedUnsafe)).toMatchObject({ tool: { name: "read", replay: "unsafe" }, restart: "stops" });
  expect(row(command)).toMatchObject({ label: "Run", subject: "run" });
  expect(row(quoted)).toMatchObject({ subject: null });
  expect(row(longPath)?.subject).toBe("x".repeat(120));
  expect(row(custom)).toMatchObject({ label: "Use `custom`", subject: null, restart: "stops" });
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|secret value|alpha|beta|gamma|delta|epsilon|zeta|"input"|"checkpoint"|"arguments"|"content"|"password"/);
  registry.install(tools(false));
  expect((await readTaskActivity(harness, parent, context)).tasks.find(task => task.id === safe)).toMatchObject({ tool: { name: "read", replay: "unsafe" }, restart: "stops" });
});

it("coalesces family graph changes at 100 ms, excludes sibling-only changes and disposes its watch", async () => {
  const { harness, parent } = await fixture();
  const other = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
  const updates: TaskGraph[] = [];
  const errors: unknown[] = [];
  const watcher = await watchTaskActivity(harness, parent.id, graph => { updates.push(graph); }, error => { errors.push(error); }, context);
  updates.length = 0;
  vi.useFakeTimers();
  try {
    const create = () => parent.commit(tx => tx.createTask(GenerationTask, {}, { ownership: { kind: "conversation" } }), context);
    await create();
    await vi.advanceTimersByTimeAsync(50);
    await create();
    await vi.advanceTimersByTimeAsync(99);
    expect(updates).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(updates).toHaveLength(1);
    expect(Object.values(updates[0]?.tasks ?? {})).toHaveLength(2);
    await other.commit(tx => tx.createTask(GenerationTask, {}, { ownership: { kind: "conversation" } }), context);
    await vi.advanceTimersByTimeAsync(100);
    expect(updates).toHaveLength(1);
    await create();
    await watcher.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(updates).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally { await watcher.stop(); vi.useRealTimers(); }
});

it("keeps one family read in flight and publishes only the newest graph when changes arrive during a read", async () => {
  const { harness, parent } = await fixture();
  const updates: TaskGraph[] = [];
  const errors: unknown[] = [];
  const watcher = await watchTaskActivity(harness, parent.id, graph => { updates.push(graph); }, error => { errors.push(error); }, context);
  updates.length = 0;
  const original = harness.commit.bind(harness);
  let release: () => void = () => { throw new Error("Read gate not initialized"); };
  const gate = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  let activeReads = 0;
  let maxActiveReads = 0;
  const commit = vi.spyOn(harness, "commit").mockImplementation(async <T>(change: (tx: Tx) => T | Promise<T>, ctx: typeof context): Promise<T> => {
    reads++;
    activeReads++;
    maxActiveReads = Math.max(maxActiveReads, activeReads);
    try { await gate; return await original(change, ctx); }
    finally { activeReads--; }
  });
  vi.useFakeTimers();
  try {
    const create = () => parent.commit(tx => tx.createTask(GenerationTask, {}, { ownership: { kind: "conversation" } }), context);
    await create();
    await vi.advanceTimersByTimeAsync(100);
    expect(reads).toBe(1);
    await create();
    await vi.advanceTimersByTimeAsync(100);
    expect(reads).toBe(1);
    expect(updates).toHaveLength(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(2);
    expect(maxActiveReads).toBe(1);
    expect(updates).toHaveLength(1);
    expect(Object.values(updates[0]?.tasks ?? {})).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally { release(); await watcher.stop(); commit.mockRestore(); vi.useRealTimers(); }
});

it("does not publish a family read that finishes after watch disposal", async () => {
  const { harness, parent } = await fixture();
  const updates: TaskGraph[] = [];
  const watcher = await watchTaskActivity(harness, parent.id, graph => { updates.push(graph); }, error => { throw error; }, context);
  updates.length = 0;
  const original = harness.commit.bind(harness);
  let resolve: () => void = () => { throw new Error("Read gate not initialized"); };
  const gate = new Promise<void>(done => { resolve = done; });
  const commit = vi.spyOn(harness, "commit").mockImplementation(async <T>(change: (tx: Tx) => T | Promise<T>, ctx: typeof context): Promise<T> => {
    await gate;
    return original(change, ctx);
  });
  vi.useFakeTimers();
  try {
    await parent.commit(tx => tx.createTask(GenerationTask, {}, { ownership: { kind: "conversation" } }), context);
    await vi.advanceTimersByTimeAsync(100);
    const stopping = watcher.stop();
    resolve();
    await stopping;
    await vi.advanceTimersByTimeAsync(100);
    expect(updates).toEqual([]);
  } finally { resolve(); await watcher.stop(); commit.mockRestore(); vi.useRealTimers(); }
});

it.each([
  // Every leak found in review rounds 1 to 3. Only the program name may appear.
  { command: String.raw`run --token "abc\" SECRET_TAIL"`, expected: "run" },
  { command: 'env "KEY=first SECRET_TAIL" run', expected: "env" },
  { command: String.raw`env K"E"Y=first\ SECRET_TAIL run`, expected: "env" },
  { command: `bash -c 'run --"token" SECRET_TAIL'`, expected: "bash" },
  { command: String.raw`bash -c 'run --to\ken SECRET_TAIL'`, expected: "bash" },
  { command: `eval 'run --"password" SECRET_TAIL'`, expected: "eval" },
  { command: `sh -c 'run --to"ken" SECRET_TAIL'`, expected: "sh" },
  { command: "env --split-string='run --token' SECRET_TAIL", expected: "env" },
  { command: "env -S'KEY=x run --token' SECRET_TAIL", expected: "env" },
  { command: "xargs env --split-string='run --token' SECRET_TAIL", expected: "xargs" },
  { command: "run --token_value SECRET_TAIL", expected: "run" },
  { command: "eval run --token '' SECRET_TAIL", expected: "eval" },
  { command: "curl -sHAuthorization:SECRET_TAIL https://example.com", expected: "curl" },
  { command: "curl -su user:SECRET_TAIL https://example.com", expected: "curl" },
  { command: "git clone https://user:SECRET_TAIL@example.com/repo.git", expected: "git" },
  { command: "tool SECRET_TAIL", expected: "tool" },
  // Leading assignments are skipped; a path keeps its basename.
  { command: "KEY=SECRET_TAIL TOKEN='SECRET_TAIL x' npm test -- durableTriggers", expected: "npm" },
  { command: "/home/SECRET_TAIL/bin/deploy --now", expected: "deploy" },
  { command: "./node_modules/.bin/vitest run", expected: "vitest" },
  // Nothing to show, or syntax the parser refuses.
  { command: "KEY=SECRET_TAIL", expected: null },
  { command: "'SECRET_TAIL program' --flag", expected: null },
  { command: "--SECRET_TAIL", expected: null },
  { command: 'run --token "first SECRET_TAIL', expected: null },
  { command: "run --token SECRET_TAIL\\", expected: null },
  { command: 'run --token "$(printf SECRET_TAIL)"', expected: null },
  { command: 'run --token "`printf SECRET_TAIL`"', expected: null },
  { command: "run <<EOF\nSECRET_TAIL\nEOF", expected: null },
  { command: "run --token SECRET_TAIL | cat", expected: null },
  { command: "run --token SECRET_TAIL; echo done", expected: null },
  { command: "run --token 'first\nSECRET_TAIL'", expected: null },
])("shows only a bash command's program name: $command", async ({ command, expected }) => {
  const storage = new MemoryStorage();
  const parent = await seedConversation(storage);
  const assistant = await storage.mintId<EntryId>();
  const call = fauxToolCall("bash", { command });
  await storage.commit([{ type: "entry", value: { id: assistant, conversationId: parent, kind: AssistantEntry.kind, model: [fauxAssistantMessage([call])] } }], context);
  await seedTask(storage, parent, "pi.tool", { input: { assistant, callId: call.id }, state: { status: "pending", checkpoint: { phase: "call" } } });
  const { harness } = await openSeed(storage);
  const result = await readTaskActivity(harness, parent, context);
  expect(JSON.stringify(result)).not.toContain("SECRET_TAIL");
  expect(result.tasks[0]?.subject).toBe(expected);
});

it.each([
  { kind: "pi.tool", phase: "call", resolved: "unsafe", saved: "unsafe", restart: "resumes" },
  { kind: "pi.tool", phase: "execute", resolved: "unsafe", saved: "safe", restart: "stops" },
  { kind: "pi.tool", phase: "execute", resolved: "safe", saved: "unsafe", restart: "stops" },
  { kind: "pi.tool", phase: "execute", resolved: "safe", saved: "safe", restart: "resumes" },
  { kind: "forgerie.gated-action-run", phase: "ready", resolved: "unsafe", saved: "unsafe", restart: "resumes" },
  { kind: "forgerie.gated-action-run", phase: "unknown", resolved: "unsafe", saved: "unsafe", restart: "stops" },
])("maps restart after saved intent only: $kind $phase $resolved/$saved", async ({ kind, phase, resolved, saved, restart }) => {
  const storage = new MemoryStorage();
  const parent = await seedConversation(storage);
  const assistant = await storage.mintId<EntryId>();
  const call = fauxToolCall("activity_tool", {});
  await storage.commit([{ type: "entry", value: { id: assistant, conversationId: parent, kind: AssistantEntry.kind, model: [fauxAssistantMessage([call])] } }], context);
  const id = await seedTask(storage, parent, kind, { input: { assistant, callId: call.id }, state: { status: "pending", checkpoint: { phase, replay: saved, arguments: {} } } });
  const { harness, registry } = await openSeed(storage, [taskDefinition("forgerie.gated-action-run")]);
  let executions = 0;
  const tools = defineExtension({ name: "restart-policy", tools: [defineTool({ name: "activity_tool", description: "Controlled activity", parameters: Type.Object({}), replay: resolved === "safe" ? "safe" : "unsafe", execute: () => { executions++; return Promise.resolve({ content: [] }); } })] });
  registry.install(tools);
  const conversation = await harness.conversation(parent, context);
  if (conversation === undefined) throw new Error("Missing seeded conversation");
  await conversation.configure({ extensions: [tools] }, context);
  const result = await readTaskActivity(harness, parent, context);
  expect(result.tasks[0]).toMatchObject({ id, status: "pending", restart });
  expect(result.tasks[0]?.tool).toEqual(kind === "pi.tool" ? { name: "activity_tool", replay: resolved === "safe" && (phase === "call" || saved === "safe") ? "safe" : "unsafe" } : null);
  expect(JSON.stringify(result)).not.toMatch(/"(?:checkpoint|phase|input|arguments)"/);
  if (kind === "pi.tool" && phase === "call") {
    harness.resume();
    await harness.waitForTask(id, context);
    expect(executions).toBe(1);
  }
});
