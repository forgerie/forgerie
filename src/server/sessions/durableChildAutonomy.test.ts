import type { ChildRun } from "../../shared/childRuns.js";
import { ManagedProcessRegistry } from "../processes/managedProcessRegistry.js";
import { controlledManagedProcessLauncher } from "../processes/managedProcesses.testSupport.js";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { getCurrentSystemPrompt, type JsonObject } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { WorkflowRunSchema } from "../../shared/workflowRuns.js";
import { workflowExtension, proposeWorkflow, startWorkflowProposal, workflowRuns, waitingWorkflowDecisions, acknowledgeWorkflowStall, WORKFLOW_STALL_GRACE_MS } from "./durableWorkflowRuns.js";
import { createRegistry, defineDoc, LiveDoc } from "@earendil-works/pi-durable";
import { afterEach, expect, it, vi } from "vitest";
import { durableChildExtensions, listChildren, stopChild, answerChildQuestion } from "./durableChildAgents.js";
import { ChildAgentCatalog } from "./durableChildProfiles.js";
import { DurableSessionJournal } from "./durableSessionJournal.js";
import { DurableChildWorktrees } from "./durableChildWorktrees.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";
import { DurableChildRunRecords } from "./durableChildRunRecords.js";
import { ChildRunStore } from "./childRunStore.js";

const roots: string[] = [];
const journals: DurableSessionJournal[] = [];
const recorders: DurableChildRunRecords[] = [];
afterEach(async () => {
  await Promise.all(recorders.splice(0).map((recorder) => recorder.close()));
  await Promise.all(journals.splice(0).map((journal) => journal.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(errors: string[] = [], holdAt?: number, recordRuns = false, onFinished?: (run: ChildRun) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "forgerie-child-autonomy-")); roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-b", "main"); git("config", "user.name", "Autonomy test"); git("config", "user.email", "test@example.invalid");
  await writeFile(join(root, "base.txt"), "base"); git("add", "base.txt"); git("commit", "-qm", "Base");
  const agentsDir = join(root, "agents"); await mkdir(agentsDir);
  for (const [name, tools] of [["reader", "read"], ["writer", "write"], ["missing", "unobtainable"], ["alternative", "read, unobtainable"]] as const) {
    await writeFile(join(agentsDir, `${name}.md`), `---\nname: ${name}\ntools: ${tools}\n---\nAUTONOMY-CHILD\n`);
  }
  const catalog = new ChildAgentCatalog([agentsDir]);
  const store = new SessionWorktreeStore(join(root, "ownership.json")); await store.initialize();
  const worktrees = new DurableChildWorktrees(new SessionWorktrees(store, { publish: () => undefined }), { id: "parent", cwd: root });
  const manager = SessionManager.create(root, join(root, "sessions"));
  const models = createModels(); const provider = fauxProvider({ tokensPerSecond: 100000 }); models.setProvider(provider.provider);
  let childCalls = 0;
  let held = false;
  const parentInputs: string[] = [];
  provider.setResponses(Array.from({ length: 100 }, () => (request) => {
    const last = request.messages.at(-1);
    const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
    if (getCurrentSystemPrompt(request.messages).includes("You are the child agent")) {
      if (text.includes("HOLD")) return fauxAssistantMessage([fauxToolCall("ask_human", { question: "Wait?" })], { stopReason: "toolUse" });
      if (!held && childCalls === holdAt) {
        held = true;
        return fauxAssistantMessage([fauxToolCall("ask_human", { question: "Wait?" })], { stopReason: "toolUse" });
      }
      const error = errors[childCalls++];
      return error === undefined ? fauxAssistantMessage(text.includes("RETRY-SUCCESS") ? "RETRY-SUCCESS" : "CHILD-SUCCESS") : fauxAssistantMessage("", { stopReason: "error", errorMessage: error });
    }
    if (last?.role === "user") {
      parentInputs.push(text);
      const part = typeof last.content === "string" ? last.content : last.content.find((part) => part.type === "text")?.text ?? "";
      const question = /^\[child \S+ asks ([^\]]+)\]/.exec(part);
      if (question !== null) return fauxAssistantMessage([fauxToolCall("child_agent", { action: "escalate", questionId: question[1] ?? "", kind: "external", guess: "Proceed", why: "Configured escalation for retry tests" })], { stopReason: "toolUse" });
      if (part.startsWith("SPAWN ")) return fauxAssistantMessage([fauxToolCall("child_agent", spawnArgs(part.slice(6)))], { stopReason: "toolUse" });
    }
    return fauxAssistantMessage("PARENT-DONE");
  }));
  const recordPath = join(root, "child-runs.json");
  let now = 1000000;
  const runStore = new ChildRunStore(recordPath, () => now);
  const recordErrors: unknown[] = [];
  const runtimeErrors: unknown[] = [];
  let recorder: DurableChildRunRecords | undefined;
  let failedWrite: Promise<void> | undefined;
  let releaseFailedWrite: (() => void) | undefined;
  const registry = createRegistry(); registry.install(workflowExtension()); const extensions = durableChildExtensions({ catalog, worktrees,
    ...(recordRuns ? { flushRunRecords: async () => { await failedWrite; await recorder?.flush(); } } : {}),
    commit: (change, ctx) => journal.harness.commit(change, ctx) });
  for (const extension of [...extensions.parent, ...extensions.childOnly]) registry.install(extension);
  async function open(corruptRecords = false) {
    // Let the retry's real history write fail before either flush caller can pass the accounting boundary.
    if (corruptRecords) failedWrite = new Promise<void>((resolve) => { releaseFailedWrite = resolve; });
    const journal = await DurableSessionJournal.open({ manager, models, registry, agent: { cwd: root, model: { provider: "faux", modelId: "faux-1" }, extensions: [...extensions.parent, workflowExtension()] },
      familyOptions: { models, registry, now: () => now, settings: { retry: { enabled: false } }, onReport: (error) => { runtimeErrors.push(error); } } });
    journals.push(journal);
    if (recordRuns) {
      recorder = await DurableChildRunRecords.open(journal.harness, journal.conversation.id, { id: "parent", cwd: root }, runStore, context,
        (error) => { recordErrors.push(error); releaseFailedWrite?.(); }, () => now, onFinished);
      recorders.push(recorder);
    }
    // Only this private history file fails. Durable can still admit the retry and run its tools.
    if (corruptRecords) await writeFile(recordPath, "{invalid child run history");
    journal.harness.resume(); return journal;
  }
  let journal = await open();
  const children = () => listChildren(journal.harness, journal.conversation.id, context, worktrees);
  async function spawn(args: JsonObject) {
    const submission = await journal.conversation.submit({ type: "input", content: `SPAWN ${JSON.stringify({ action: "spawn", message: "Answer", ...args })}` }, context);
    await submission.wait(context);
    return journal.conversation.context(context);
  }
  return { root, runStore, children, spawn, parentInputs, calls: () => childCalls, journal: () => journal, worktrees,
    restart: async (at: number, corruptRecords = false) => { await recorder?.close(); await journal.close(); now = at; journal = await open(corruptRecords); },
    advanceClock: (ms: number) => { now += ms; },
    recordPath, recordErrors, runtimeErrors,
    activeChildRun: async (id: number) => { await recorder?.flush(); return recorder?.activeChildRun(id); },
    startWorkflow: async () => {
      const proposal = await journal.conversation.commit((tx) => proposeWorkflow(tx, journal.conversation.id, "p:autonomy", { name: "autonomy", summary: "Autonomy check", text: "---\nworkflow: {version: 1}\n---\nWait.", basis: { kind: "new" as const, reason: "No saved workflow fits." } }), context);
      await startWorkflowProposal(journal.harness, journal.conversation, root, "parent", proposal.id, {}, "start", context);
      await vi.waitFor(() => { expect(parentInputs.some((text) => text.includes("Workflow run "))).toBe(true); });
      await vi.waitFor(async () => { expect((await journal.harness.snapshot(LiveDoc, journal.conversation.id, context))?.run).toBeUndefined(); });
    },
    runs: () => workflowRuns(journal.harness, journal.conversation.id, context),
    answer: async () => {
      const question = (await children())[0]?.questions[0];
      if (question === undefined) throw new Error("Missing child question");
      await answerChildQuestion(journal.conversation, question.questionId, "Proceed", context);
    },
    stop: async (id: number) => stopChild(journal.harness, journal.conversation, id, context, worktrees),
    waiting: () => waitingWorkflowDecisions(journal.harness, journal.conversation.id, context),
    acknowledge: () => journal.conversation.commit((tx) => acknowledgeWorkflowStall(tx, journal.conversation.id), context),
    /** Stall watches that have not finished. */
    stallWatches: () => journal.conversation.commit(async (tx) => {
      let count = 0;
      for (const status of ["pending", "running", "waiting", "completing"] as const) {
        count += (await tx.scanTasks({ status }, 100)).items.filter((task) => task.kind === "forgerie.workflow-stall").length;
      }
      return count;
    }, context) };
}

const WAKE = 'Child "broken" failed and nothing has run since';
async function failedAndReported(run: Awaited<ReturnType<typeof fixture>>) {
  await run.startWorkflow();
  await run.spawn({ name: "broken", agent: "reader" });
  await vi.waitFor(async () => { expect((await run.runs())[0]?.children[0]?.state).toMatchObject({ kind: "settled", outcome: "failed", delivered: true }); });
  await vi.waitFor(async () => { expect((await run.journal().harness.snapshot(LiveDoc, run.journal().conversation.id, context))?.run).toBeUndefined(); });
}
it("wakes the agent once when a run sits idle after a child failed, then flags the run for the user", async () => {
  const run = await fixture(["Invalid API key"]);
  await failedAndReported(run);
  expect((await run.runs())[0]?.stall).toBeUndefined();
  expect(await run.stallWatches()).toBe(1);
  await run.restart(1000000 + WORKFLOW_STALL_GRACE_MS);
  await vi.waitFor(() => { expect(run.parentInputs.filter((text) => text.includes(WAKE))).toHaveLength(1); });
  expect(run.parentInputs.find((text) => text.includes(WAKE))).toContain("Invalid API key");
  await vi.waitFor(async () => { expect((await run.runs())[0]?.stall).toMatchObject({ state: "woken", child: "broken" }); });
  expect(await run.waiting()).toBe(0);
  // The faux agent only replies, so nothing runs after the wake.
  await run.restart(1000000 + 2 * WORKFLOW_STALL_GRACE_MS);
  await vi.waitFor(async () => { expect((await run.runs())[0]?.stall).toMatchObject({ state: "flagged", child: "broken" }); });
  expect((await run.runs())[0]?.stall?.error).toContain("Invalid API key");
  expect(await run.waiting()).toBe(1);
  expect(await run.stallWatches()).toBe(0);
  expect(run.parentInputs.filter((text) => text.includes(WAKE))).toHaveLength(1);
  await run.acknowledge();
  expect((await run.runs())[0]?.stall).toBeUndefined();
  expect(await run.waiting()).toBe(0);
});
it("ends the stall watch without waking the agent when it starts new work", async () => {
  const run = await fixture(["Invalid API key"]);
  await failedAndReported(run);
  await run.spawn({ name: "again", agent: "reader" });
  await vi.waitFor(async () => { expect((await run.runs())[0]?.children[1]?.state).toMatchObject({ kind: "settled", outcome: "answered" }); });
  await run.restart(1000000 + WORKFLOW_STALL_GRACE_MS);
  await vi.waitFor(async () => { expect(await run.stallWatches()).toBe(0); });
  expect(run.parentInputs.some((text) => text.includes(WAKE))).toBe(false);
  expect((await run.runs())[0]?.stall).toBeUndefined();
});
it("does not flag the user after they wrote to the woken agent", async () => {
  const run = await fixture(["Invalid API key"]);
  await failedAndReported(run);
  await run.restart(1000000 + WORKFLOW_STALL_GRACE_MS);
  await vi.waitFor(async () => { expect((await run.runs())[0]?.stall?.state).toBe("woken"); });
  await run.acknowledge();
  await run.restart(1000000 + 2 * WORKFLOW_STALL_GRACE_MS);
  await vi.waitFor(async () => { expect(await run.stallWatches()).toBe(0); });
  expect((await run.runs())[0]?.stall).toBeUndefined();
  expect(await run.waiting()).toBe(0);
});

it.each(["answered", "failed", "stopped"] as const)("ends a managed child process on committed %s completion, unless kept", async (outcome) => {
  const control = controlledManagedProcessLauncher();
  const run = await fixture(outcome === "failed" ? ["Invalid API key"] : [], undefined, true, async (finished) => {
    await registry.childFinished(finished.session.id, { name: finished.child.name, runId: finished.id });
  });
  const registry: ManagedProcessRegistry = new ManagedProcessRegistry({ stateDirectory: run.root, prepareLauncher: () => Promise.resolve(control.launcher), onError: (error) => { throw error; } });
  try {
    const owner = await registry.get("parent");
    await run.spawn({ name: "reader", agent: "reader", message: "HOLD" });
    await vi.waitFor(async () => { expect((await run.children())[0]?.questions).toHaveLength(1); });
    const first = (await run.runStore.list())[0];
    if (first === undefined) throw new Error("Missing first run");
    const child = { name: first.child.name, runId: first.id };
    await owner.start({ id: "temporary", command: "cat", cwd: run.root, child });
    await owner.start({ id: "kept", command: "cat", cwd: run.root, child, keepAfterChild: true });
    if (outcome === "stopped") await run.stop(first.child.conversationId);
    else await run.answer();
    await vi.waitFor(async () => { expect((await run.runStore.list())[0]?.state).toMatchObject({ kind: "finished", outcome }); });
    expect(control.stopped).toEqual(["parent/temporary"]);
    expect((await owner.status("temporary")).state.kind).toBe("lost");
    expect((await owner.status("kept")).state.kind).toBe("running");
    if (outcome === "answered") {
      await run.spawn({ action: "send", name: "reader", message: "HOLD" });
      await vi.waitFor(async () => { expect((await run.runStore.pending("parent"))).toHaveLength(1); });
      const second = (await run.runStore.pending("parent"))[0]?.run;
      if (second === undefined) throw new Error("Missing second run");
      expect(second.id).not.toBe(first.id);
      await owner.start({ id: "second", command: "cat", cwd: run.root, child: { name: second.child.name, runId: second.id } });
      await registry.childFinished("parent", child); // replaying the old completion must not stop the new run
      expect((await owner.status("second")).state.kind).toBe("running");
      await run.stop(second.child.conversationId);
      await vi.waitFor(() => { expect(control.stopped).toContain("parent/second"); });
    }
    expect(run.recordErrors).toEqual([]);
  } finally { await registry.dispose(); }
});

it("refuses missing tools with catalog alternatives, unless explicitly allowed", async () => {
  const run = await fixture();
  expect(JSON.stringify(await run.spawn({ name: "refused", agent: "missing" }))).toContain("unobtainable");
  expect(JSON.stringify(await run.spawn({ name: "also-refused", agent: "missing" }))).toContain("alternative");
  expect(await run.children()).toEqual([]);
  await run.spawn({ name: "allowed", agent: "missing", allowMissingTools: true });
  await vi.waitFor(async () => { expect((await run.children()).map((child) => child.name)).toEqual(["allowed"]); });
});
it("defaults writers and general helpers to worktrees, readers to shared, and honors explicit isolation", async () => {
  const run = await fixture();
  for (const args of [{ name: "writer", agent: "writer" }, { name: "helper" }, { name: "reader", agent: "reader" }, { name: "shared", agent: "writer", isolation: "shared" }, { name: "isolated", agent: "reader", isolation: "worktree" }]) {
    await run.spawn(args);
    await vi.waitFor(async () => { expect((await run.children()).every((child) => !child.busy)).toBe(true); });
  }
  const children = await run.children();
  expect(children.filter((child) => child.worktree !== undefined).map((child) => child.name)).toEqual(["writer", "helper", "isolated"]);
  // The gate treats exactly these active child worktrees as disposable.
  expect((await run.worktrees.activePaths()).sort()).toEqual(children.flatMap((child) => child.worktree === undefined ? [] : [child.worktree.path]).sort());
});
it("refuses a second busy shared writer and names the first child", async () => {
  const run = await fixture();
  await run.spawn({ name: "first", agent: "writer", isolation: "shared", message: "HOLD" });
  await vi.waitFor(async () => { expect((await run.children())[0]?.busy).toBe(true); });
  const result = JSON.stringify(await run.spawn({ name: "second", agent: "writer", isolation: "shared" }));
  expect(result).toContain("first");
  expect((await run.children()).map((child) => child.name)).toEqual(["first"]);
  await run.spawn({ name: "reader", agent: "reader", message: "HOLD" });
  expect((await run.children()).map((child) => child.name)).toEqual(["first", "reader"]);
});
it("checkpoints a 30 second retry, survives restart, and reports only the successful answer", async () => {
  const run = await fixture(["overloaded"]);
  await run.startWorkflow();
  await run.spawn({ name: "retry", agent: "reader" });
  await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toEqual({ attempt: 1, max: 3, error: "overloaded", until: 1030000 }); });
  expect(run.parentInputs.some((text) => text.includes("failed:"))).toBe(false);
  expect((await run.runs())[0]?.children[0]?.state).toEqual({ kind: "working" });
  await run.restart(1030000);
  await vi.waitFor(() => { expect(run.parentInputs.some((text) => text.includes("CHILD-SUCCESS"))).toBe(true); });
  expect((await run.children())[0]?.retry).toBeUndefined();
  expect(run.calls()).toBe(2);
  await vi.waitFor(async () => { expect((await run.runs())[0]?.children[0]?.state).toMatchObject({ kind: "settled", outcome: "answered", result: "CHILD-SUCCESS", delivered: true }); });
});
it("caps retries at three with 30 second, 2 minute, and 5 minute waits, then sends the real error", async () => {
  const run = await fixture(["overloaded", "HTTP 503 unavailable", "WebSocket closed", "stream disconnected: exhausted"]);
  await run.startWorkflow();
  await run.spawn({ name: "retry", agent: "reader" });
  let at = 1000000;
  for (const [index, delay] of [30000, 120000, 300000].entries()) {
    at += delay;
    await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toMatchObject({ attempt: index + 1, max: 3, until: at }); });
    await run.restart(at);
  }
  await vi.waitFor(() => { expect(run.parentInputs.some((text) => text.includes("stream disconnected: exhausted"))).toBe(true); });
  expect(run.calls()).toBe(4);
  expect(run.parentInputs.filter((text) => text.includes("[subagent retry failed:"))).toHaveLength(1);
  await vi.waitFor(async () => { expect((await run.runs())[0]?.children[0]?.state).toMatchObject({ kind: "settled", outcome: "failed", result: "stream disconnected: exhausted", delivered: true }); });
});
it.each(["auth_unavailable", "HTTP 599", "connection reset"])("retries the transient provider error %s", async (error) => {
  const run = await fixture([error]);
  await run.spawn({ name: "retry", agent: "reader" });
  await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toMatchObject({ attempt: 1, error }); });
});
it.each(["Invalid API key", "insufficient_quota 503", "Context window limit overloaded", "quota exceeded 429"])("does not retry the non-transient model error %s", async (error) => {
  const run = await fixture([error]);
  await run.spawn({ name: "error", agent: "reader" });
  await vi.waitFor(() => { expect(run.parentInputs.some((text) => text.includes(error))).toBe(true); });
  expect(run.calls()).toBe(1);
  expect((await run.children())[0]?.retry).toBeUndefined();
});
it("stops a retrying child without restarting it after the wait", async () => {
  const run = await fixture(["overloaded"]);
  await run.startWorkflow();
  await run.spawn({ name: "retry", agent: "reader" });
  await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toBeDefined(); });
  await run.stop((await run.children())[0]?.conversationId ?? 0);
  await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toBeUndefined(); });
  expect((await run.runs())[0]?.children[0]?.state).toMatchObject({ kind: "settled", outcome: "stopped", delivered: "aborted" });
  await run.restart(1030000);
  expect((await run.children())[0]?.retry).toBeUndefined();
  expect((await run.runs())[0]?.children[0]?.state).toMatchObject({ outcome: "stopped", delivered: "aborted" });
  expect(run.calls()).toBe(1);
});


it.each(["success", "exhausted", "stop"] as const)("shares one durable retry owner after spawn plus steer: %s", async (outcome) => {
  const errors = outcome === "exhausted" ? ["overloaded", "HTTP 503", "WebSocket closed", "stream disconnected: final error"] : ["overloaded"];
  const run = await fixture(errors);
  await run.startWorkflow();
  await run.spawn({ name: "retry", agent: "reader", message: "HOLD" });
  await vi.waitFor(async () => { expect((await run.children())[0]?.questions).toHaveLength(1); });
  await run.spawn({ action: "send", name: "retry", message: "Steer" });
  await run.answer();
  await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toMatchObject({ attempt: 1, until: 1030000 }); });
  expect((await run.runs())[0]?.children.map((child) => child.state)).toEqual([{ kind: "working" }, { kind: "working" }]);
  expect(run.parentInputs.filter((text) => text.includes("[subagent retry"))).toHaveLength(0);
  if (outcome === "stop") {
    await run.stop((await run.children())[0]?.conversationId ?? 0);
    await run.restart(1030000);
    expect((await run.children())[0]?.retry).toBeUndefined();
    expect((await run.runs())[0]?.children.map((child) => child.state)).toEqual([
      { kind: "settled", outcome: "stopped", result: "aborted", delivered: "aborted" },
      { kind: "settled", outcome: "stopped", result: "aborted", delivered: "aborted" },
    ]);
    expect(run.calls()).toBe(1);
    expect(run.parentInputs.filter((text) => text.includes("[subagent retry"))).toHaveLength(0);
    return;
  }
  let at = 1000000;
  for (const [index, delay] of (outcome === "exhausted" ? [30000, 120000, 300000] : [30000]).entries()) {
    at += delay;
    await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toMatchObject({ attempt: index + 1, until: at }); });
    await run.restart(at);
  }
  const result = outcome === "success" ? "CHILD-SUCCESS" : "stream disconnected: final error";
  await vi.waitFor(async () => {
    const states = (await run.runs())[0]?.children.map((child) => child.state);
    expect(states).toHaveLength(2);
    expect(states?.map((state) => state.kind === "settled" ? state.delivered : false).sort()).toEqual(["duplicate", true].sort());
    expect(states?.every((state) => state.kind === "settled" && state.outcome === (outcome === "success" ? "answered" : "failed") && state.result === result)).toBe(true);
  });
  expect(run.calls()).toBe(outcome === "success" ? 2 : 4);
  expect(run.parentInputs.filter((text) => text.includes("[subagent retry"))).toHaveLength(1);
  expect(run.parentInputs.find((text) => text.includes("[subagent retry"))).toContain(result);
  expect((await run.children())[0]?.retry).toBeUndefined();
});

it("keeps an observer waiting after its owner faults on run-record flush, then preserves the retry's answer", async () => {
  const run = await fixture(["overloaded"], 1, true);
  await run.startWorkflow();
  await run.spawn({ name: "retry", agent: "reader", message: "HOLD" });
  await vi.waitFor(async () => { expect((await run.children())[0]?.questions).toHaveLength(1); });
  await run.spawn({ action: "send", name: "retry", message: "Steer" });
  await run.answer();
  await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toMatchObject({ attempt: 1, until: 1030000 }); });
  const savedRecords = await readFile(run.recordPath, "utf8");
  await run.restart(1030000, true);
  try {
    await vi.waitFor(async () => { expect((await run.children())[0]?.questions).toHaveLength(1); });
    await vi.waitFor(() => { expect(run.recordErrors.length).toBeGreaterThan(0); });
    await vi.waitFor(async () => {
      const reporters = await run.journal().harness.commit((tx) => tx.scanTasks({ kind: "forgerie.child-reporter", status: "terminal" }, 100), context);
      expect(reporters.items.filter((task) => task.state.status === "terminal" && task.state.outcome.status === "faulted")).toHaveLength(1);
    });
    // Let the observer finish a poll while the admitted retry is still placed and waiting on the question.
    run.advanceClock(1000);
    await sleep(350);
    await writeFile(run.recordPath, savedRecords);
    const question = (await run.children())[0]?.questions[0];
    if (question === undefined) throw new Error("Missing retry question");
    await answerChildQuestion(run.journal().conversation, question.questionId, "RETRY-SUCCESS", context);
    run.advanceClock(1000);
    await vi.waitFor(async () => {
      run.advanceClock(250);
      const states = (await run.runs())[0]?.children.map((child) => child.state);
      expect(states).toHaveLength(2);
      expect(states).toEqual([
        expect.objectContaining({ kind: "settled", outcome: "answered", result: "RETRY-SUCCESS" }),
        expect.objectContaining({ kind: "settled", outcome: "answered", result: "RETRY-SUCCESS" }),
      ]);
    }, { timeout: 5000 });
    expect(run.runtimeErrors.some((error) => String(error).includes("returned without durable progress"))).toBe(false);
    expect(run.calls()).toBe(2);
  } finally {
    await writeFile(run.recordPath, savedRecords);
  }
});

it("keeps the remaining retry budget when a new steer joins a retry run", async () => {
  const run = await fixture(["overloaded", "HTTP 503", "WebSocket closed", "stream disconnected: final error"], 1);
  await run.startWorkflow();
  await run.spawn({ name: "retry", agent: "reader" });
  await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toMatchObject({ attempt: 1, until: 1030000 }); });
  await run.restart(1030000);
  await vi.waitFor(async () => { expect((await run.children())[0]?.questions).toHaveLength(1); });
  await run.spawn({ action: "send", name: "retry", message: "Steer" });
  await run.answer();
  for (const [attempt, until] of [[2, 1150000], [3, 1450000]] as const) {
    await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toMatchObject({ attempt, until }); });
    await run.restart(until);
  }
  await vi.waitFor(async () => {
    const states = (await run.runs())[0]?.children.map((child) => child.state);
    expect(states?.every((state) => state.kind === "settled" && state.outcome === "failed" && state.result === "stream disconnected: final error")).toBe(true);
    expect(states?.map((state) => state.kind === "settled" ? state.delivered : false).sort()).toEqual(["duplicate", true].sort());
  });
  expect(run.calls()).toBe(4);
  expect(run.parentInputs.filter((text) => text.includes("[subagent retry"))).toHaveLength(1);
});

it("records duplicate answers and stopped-before-reporting as distinct non-error delivery states", async () => {
  const run = await fixture();
  await run.startWorkflow();
  await run.spawn({ name: "reader", agent: "reader", message: "HOLD" });
  await vi.waitFor(async () => { expect((await run.children())[0]?.questions).toHaveLength(1); });
  await run.spawn({ action: "send", name: "reader", message: "Steer" });
  await run.answer();
  await vi.waitFor(async () => {
    const states = (await run.runs())[0]?.children.map((child) => child.state);
    expect(states?.every((state) => state.kind === "settled")).toBe(true);
    expect(states?.map((state) => state.kind === "settled" ? state.delivered : false).sort()).toEqual(["duplicate", true].sort());
    expect(states?.some((state) => state.kind === "settled" && state.deliveryError !== undefined)).toBe(false);
  });
  await run.spawn({ name: "stopped", agent: "reader", message: "HOLD" });
  await vi.waitFor(async () => { expect((await run.children()).find((child) => child.name === "stopped")?.questions).toHaveLength(1); });
  await run.stop((await run.children()).find((child) => child.name === "stopped")?.conversationId ?? 0);
  await vi.waitFor(async () => { expect((await run.runs())[0]?.children.at(-1)?.state).toMatchObject({ kind: "settled", delivered: "aborted" }); });
});
it("still parses and reads an old false delivery flag with a suppressed-report string", async () => {
  const run = await fixture(); await run.startWorkflow();
  const record = (await run.runs())[0];
  if (record === undefined) throw new Error("Missing workflow");
  const legacy = { ...record, children: [{ name: "old", conversationId: 123, reporterId: 456,
    state: { kind: "settled", outcome: "stopped", result: "aborted", delivered: false, deliveryError: "Completion report suppressed; no parent message was submitted." } }] };
  if (!Check(WorkflowRunSchema, legacy)) throw new Error("Legacy record did not parse");
  // Reading through the production projection must not reinterpret old error strings as new delivery labels.
  const runs = defineDoc<{ active: string | null; records: Record<string, typeof record> }>({ kind: "forgerie.workflow-runs", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ active: null, records: {} }) });
  await run.journal().conversation.commit(async (tx) => { const doc = await tx.doc(runs, run.journal().conversation.id); doc.records[record.id] = structuredClone(legacy); }, context);
  expect((await run.runs())[0]?.children[0]?.state).toMatchObject({ delivered: false, deliveryError: legacy.children[0]?.state.deliveryError });
});

function spawnArgs(text: string) {
  const value: unknown = JSON.parse(text);
  if (!Check(Type.Record(Type.String(), Type.Union([Type.String(), Type.Boolean()])), value)) throw new Error("Invalid spawn arguments");
  return value;
}


it("resolves child process ownership only to a persisted running child run", async () => {
  const f = await fixture([], undefined, true);
  expect(await f.activeChildRun(f.journal().conversation.id)).toBeUndefined();
  await f.spawn({ name: "held", agent: "reader", message: "HOLD" });
  await vi.waitFor(async () => { expect((await f.children())[0]?.questions.length).toBe(1); });
  const child = (await f.children())[0];
  if (child === undefined) throw new Error("Missing held child");
  const owner = await f.activeChildRun(child.conversationId);
  const persisted = (await new ChildRunStore(f.recordPath).list())[0];
  expect(owner).toEqual({ name: "held", runId: persisted?.id });
  await f.restart(1000100);
  expect(await f.activeChildRun(child.conversationId)).toEqual(owner);
  await f.stop(child.conversationId);
  await vi.waitFor(async () => { expect(await f.activeChildRun(child.conversationId)).toBeUndefined(); });
});
