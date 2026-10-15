import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AssistantEntry, createRegistry, defineExtension, ToolTask, wrapTool, type JsonObject, type TaskId } from "@earendil-works/pi-durable";
import { afterEach, expect, it, vi } from "vitest";
import { SessionWorktreeStore } from "../workspaces/sessionWorktreeStore.js";
import { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import { durableChildExtensions, durableChildRunMetadata } from "./durableChildAgents.js";
import { DurableChildWorktrees } from "./durableChildWorktrees.js";
import { DurableSessionJournal } from "./durableSessionJournal.js";
import { decideWorkflowStop, proposeWorkflow, startWorkflowProposal, workflowExtension, workflowProposals, workflowRuns, WORKFLOW_PROPOSAL_KIND, WORKFLOW_STOP_KIND } from "./durableWorkflowRuns.js";

const execute = promisify(execFile);
const directories: string[] = [];
const journals: DurableSessionJournal[] = [];
afterEach(async () => {
  await Promise.all(journals.splice(0).map(journal => journal.close()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function fixture(withWorktrees = false) {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-parent-tool-replay-"));
  directories.push(directory);
  const manager = SessionManager.create(directory, join(directory, "sessions"));
  manager.appendMessage(fauxAssistantMessage("Prior context"));
  const store = new SessionWorktreeStore(join(directory, "worktrees.json"));
  await store.initialize();
  const worktrees = new SessionWorktrees(store, { publish: () => undefined });
  const childWorktrees = new DurableChildWorktrees(worktrees, { id: manager.getSessionId(), cwd: directory });
  if (withWorktrees) {
    for (const args of [["init", "-b", "main"], ["config", "user.email", "test@example.invalid"], ["config", "user.name", "Test"]]) await execute("git", ["-C", directory, ...args]);
    await writeFile(join(directory, "base.txt"), "base\n");
    await execute("git", ["-C", directory, "add", "base.txt"]);
    await execute("git", ["-C", directory, "commit", "-m", "base"]);
  }
  const models = createModels();
  const provider = fauxProvider();
  models.setProvider(provider.provider);
  provider.setResponses(Array.from({ length: 30 }, () => fauxAssistantMessage("Done.")));
  const registry = createRegistry();
  const children = durableChildExtensions({ worktrees: childWorktrees });
  const workflows = workflowExtension();
  for (const extension of [...children.parent, ...children.childOnly, workflows]) registry.install(extension);
  const options = { manager, models, registry, agent: { cwd: directory, model: { provider: "faux", modelId: "faux-1" }, extensions: [...children.parent, workflows] } };
  const journal = await DurableSessionJournal.open(options);
  journals.push(journal);
  return { directory, store, childWorktrees, registry, options, journal };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function call(journal: DurableSessionJournal, name: string, args: JsonObject, callId = "crashed-call") {
  return journal.conversation.commit(async tx => {
    const entry = await tx.appendEntry(AssistantEntry, journal.conversation.id, {
      model: [fauxAssistantMessage([fauxToolCall(name, args, { id: callId })], { stopReason: "toolUse" })],
    });
    return tx.createTask(ToolTask, { assistant: entry.id, callId }, { ownership: { kind: "conversation" } });
  }, context);
}

/** Pause after the real tool commits its effect, then close without settling its ToolTask. */
async function replay<T>(f: Fixture, name: string, args: JsonObject, observe: (journal: DurableSessionJournal) => Promise<T>,
  beforeResume?: (journal: DurableSessionJournal) => Promise<void>, pauseAt: "receipt" | "worktree" = "receipt") {
  const tool = (await f.journal.conversation.agent(context)).tools.find(candidate => candidate.name === name);
  if (tool === undefined) throw new Error(`Missing tool ${name}`);
  let entered: TaskId | undefined;
  let initialError = false;
  const pause = defineExtension({ name: "test.pause-after-effect", wraps: [wrapTool(tool, inner => ({ ...inner,
    execute: async (input, api, ctx) => {
      const hold = async () => { entered = api.taskId; await sleep(60_000, undefined, { signal: ctx.abortSignal }); };
      const prepare = f.childWorktrees.prepare.bind(f.childWorktrees);
      const intercepted = pauseAt === "worktree" ? vi.spyOn(f.childWorktrees, "prepare").mockImplementation(async (requestId, fromDefault) => {
        const checkout = await prepare(requestId, fromDefault);
        await hold();
        return checkout;
      }) : undefined;
      try {
        const result = await inner.execute(input, api, ctx);
        initialError = result.isError === true;
        if (pauseAt === "receipt") await hold();
        return result;
      } finally { intercepted?.mockRestore(); }
    },
  }))] });
  f.registry.install(pause);
  await f.journal.conversation.configure({ extensions: { add: [pause] } }, context);
  const taskId = await call(f.journal, name, args);
  f.journal.harness.resume();
  await vi.waitFor(() => { expect(entered).toBe(taskId); });
  expect(initialError).toBe(false);
  const before = await observe(f.journal);
  await f.journal.close();
  // Closing cancels the invocation, not the committed intent or its receipts.
  f.registry.install(defineExtension({ name: pause.name }));
  const file = f.options.manager.getSessionFile();
  if (file === undefined) throw new Error("Fixture must persist");
  const recovered = await DurableSessionJournal.open({ ...f.options, manager: SessionManager.open(file) });
  journals.push(recovered);
  const pending = await recovered.harness.getTask(taskId, context);
  expect(pending?.state).toMatchObject({ status: "pending", checkpoint: { phase: "execute", replay: "safe" } });
  await beforeResume?.(recovered);
  const finished = await recovered.harness.waitForTask(taskId, context);
  expect(finished.state.outcome.status).toBe("completed");
  const entries = await recovered.conversation.entries({ order: "ascending" }, 100, undefined, context);
  const result = entries.items.flatMap(entry => entry.model ?? []).find(message => message.role === "toolResult" && message.toolCallId === "crashed-call");
  expect(result).toMatchObject({ role: "toolResult", isError: false });
  return { recovered, before, after: await observe(recovered), taskId };
}

async function cards(journal: DurableSessionJournal, kind: string) {
  return (await journal.conversation.entries({ order: "ascending" }, 100, undefined, context)).items.filter(entry => entry.kind === kind);
}
async function reporters(journal: DurableSessionJournal) {
  return (await journal.harness.commit(tx => tx.scanTasks({ conversationId: journal.conversation.id, kind: "forgerie.child-reporter" }, 100), context)).items;
}
async function childEffects(f: Fixture, journal: DurableSessionJournal) {
  return { children: await durableChildRunMetadata(journal.harness, journal.conversation.id, context),
    reporters: (await reporters(journal)).map(task => task.id), worktrees: (await f.store.list()).map(record => ({ id: record.id, path: record.path, branch: record.branch })) };
}
async function run(f: Fixture, withStop = false) {
  const text = withStop ? "---\nworkflow:\n  version: 1\n  stages:\n    - {id: review, name: Review, stop: approve}\n---\nWait for review.\n" : "---\nworkflow: {version: 1}\n---\nFinish the work.\n";
  const proposal = await f.journal.conversation.commit(tx => proposeWorkflow(tx, f.journal.conversation.id, "setup-proposal", { name: "one-task", summary: "Do the task.", text, basis: { kind: "new" as const, reason: "No saved workflow fits." } }), context);
  const launched = await startWorkflowProposal(f.journal.harness, f.journal.conversation, f.directory, f.options.manager.getSessionId(), proposal.id, {}, "setup-launch", context);
  const tasks = await f.journal.harness.commit(tx => tx.scanTasks({ conversationId: f.journal.conversation.id, kind: "forgerie.workflow-launch" }, 100), context);
  for (const task of tasks.items) await f.journal.harness.waitForTask(task.id, context);
  await f.journal.conversation.waitForIdle(context);
  return launched;
}

it("replays child_agent spawn using the same child, reporter, and isolated worktree", async () => {
  const f = await fixture(true);
  const result = await replay(f, "child_agent", { action: "spawn", name: "builder", message: "First work.", isolation: "worktree" }, journal => childEffects(f, journal));
  expect(result.before.reporters).toHaveLength(1);
  expect(result.before.worktrees).toHaveLength(1);
  expect(Object.keys(result.before.children)).toEqual(["builder"]);
  expect(result.after).toEqual(result.before);
});

it("replays a spawn interrupted after worktree creation but before its child receipt", async () => {
  const f = await fixture(true);
  const result = await replay(f, "child_agent", { action: "spawn", name: "builder", message: "First work.", isolation: "worktree" },
    journal => childEffects(f, journal), undefined, "worktree");
  expect(result.before.children).toEqual({});
  expect(result.before.reporters).toHaveLength(0);
  expect(result.before.worktrees).toHaveLength(1);
  expect(result.after.worktrees).toEqual(result.before.worktrees);
  expect(Object.keys(result.after.children)).toEqual(["builder"]);
  expect(result.after.reporters).toHaveLength(1);
});

it("replays child_agent send without allocating another reporter or delivering twice", async () => {
  const f = await fixture(true);
  await f.journal.harness.waitForTask(await call(f.journal, "child_agent", { action: "spawn", name: "builder", message: "First work.", isolation: "worktree" }, "setup-spawn"), context);
  for (const task of await reporters(f.journal)) await f.journal.harness.waitForTask(task.id, context);
  const result = await replay(f, "child_agent", { action: "send", name: "builder", message: "Second work." }, journal => childEffects(f, journal));
  expect(result.before.reporters).toHaveLength(2);
  expect(result.after).toEqual(result.before);
  for (const task of await reporters(result.recovered)) await result.recovered.harness.waitForTask(task.id, context);
  const child = result.after.children["builder"];
  if (child === undefined) throw new Error("Child missing");
  const conversation = await result.recovered.harness.conversation(child.conversationId, context);
  expect((await conversation?.context(context))?.messages.filter(message => message.role === "user" && message.content === "Second work.")).toHaveLength(1);
});

it("replays propose_workflow by its task-keyed proposal ID without another card", async () => {
  const f = await fixture();
  const result = await replay(f, "propose_workflow", { name: "one-task", summary: "Do the task.", text: "---\nworkflow: {version: 1}\n---\nDo the work.\n", basis: { kind: "new", reason: "No saved workflow fits." } },
    async journal => ({ proposals: await workflowProposals(journal.harness, journal.conversation.id, context), cards: await cards(journal, WORKFLOW_PROPOSAL_KIND) }));
  expect(result.before.proposals).toHaveLength(1);
  expect(result.before.proposals[0]?.id).toBe(`p:${String(result.taskId)}`);
  expect(result.before.cards).toHaveLength(1);
  expect(result.after).toEqual(result.before);
});

it("replays workflow_finish using the stored terminal outcome without changing its timestamp", async () => {
  const f = await fixture();
  const launched = await run(f);
  const result = await replay(f, "workflow_finish", { runId: launched.id, outcome: "completed", result: "Verified." },
    journal => workflowRuns(journal.harness, journal.conversation.id, context));
  expect(result.before[0]?.state).toMatchObject({ kind: "finished", outcome: "completed", result: "Verified." });
  expect(result.after).toEqual(result.before);
});

it("replays workflow_stop without another decision card or stop-state change", async () => {
  const f = await fixture();
  const launched = await run(f, true);
  const result = await replay(f, "workflow_stop", { runId: launched.id, stage: "review", summary: "Review the result." },
    async journal => ({ runs: await workflowRuns(journal.harness, journal.conversation.id, context), cards: await cards(journal, WORKFLOW_STOP_KIND) }));
  expect(result.before.runs[0]?.stops?.["review"]?.state).toBe("waiting");
  expect(result.before.cards).toHaveLength(1);
  expect(result.after).toEqual(result.before);
});

it.each(["posted", "already-waiting"])("a %s workflow_stop replay keeps the user's intervening changes decision and does not ask again", async state => {
  const f = await fixture();
  const launched = await run(f, true);
  if (state === "already-waiting") await f.journal.harness.waitForTask(await call(f.journal, "workflow_stop", {
    runId: launched.id, stage: "review", summary: "Original request.",
  }, "setup-stop"), context);
  const result = await replay(f, "workflow_stop", { runId: launched.id, stage: "review", summary: "Review the result." },
    async journal => ({ runs: await workflowRuns(journal.harness, journal.conversation.id, context), cards: await cards(journal, WORKFLOW_STOP_KIND) }),
    async journal => { await decideWorkflowStop(journal.harness, journal.conversation, launched.id, "review", "changes", "Revise this.", () => Promise.resolve({ landed: [] }), context); });
  expect(result.after.runs[0]?.stops?.["review"]).toMatchObject({ state: "open", note: "Revise this.", round: 1 });
  expect(result.after.cards).toEqual(result.before.cards);
  // A genuinely new task can ask again after the requested revision.
  await result.recovered.harness.waitForTask(await call(result.recovered, "workflow_stop", { runId: launched.id, stage: "review", summary: "Revised result." }, "new-stop"), context);
  expect(await cards(result.recovered, WORKFLOW_STOP_KIND)).toHaveLength(2);
});
