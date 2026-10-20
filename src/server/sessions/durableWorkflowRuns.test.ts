import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { awaitWithContext, BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRegistry, defineExtension, defineTask } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { durableChildExtensions } from "./durableChildAgents.js";
import { DurableSessionJournal } from "./durableSessionJournal.js";
import type { WorkflowRun } from "../../shared/workflowRuns.js";
import { associateWorkflowChild, autoStopFailureAdvice, decideWorkflowStop, proposeWorkflow, requestWorkflowStop, startWorkflowProposal, workflowExtension, workflowProposals, workflowRuns, WORKFLOW_DOC_KIND, WORKFLOW_PROPOSALS_DOC_KIND } from "./durableWorkflowRuns.js";

it("replays a proposal without another entry and commits Start's run and decision together", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-workflow-proposal-commit-"));
  const manager = SessionManager.create(directory, directory);
  manager.appendMessage(fauxAssistantMessage("Prior context"));
  const models = createModels();
  const provider = fauxProvider();
  models.setProvider(provider.provider);
  provider.setResponses([fauxAssistantMessage("Waiting.")]);
  const registry = createRegistry();
  registry.install(workflowExtension());
  const journal = await DurableSessionJournal.open({ manager, models, registry, agent: { model: { provider: "faux", modelId: "faux-1" } } });
  try {
    const args = { name: "one-task", summary: "Plan this task.", text: "---\nworkflow: {version: 1}\n---\nWait for review.\n", basis: { kind: "new" as const, reason: "No saved workflow fits." } };
    const propose = () => journal.conversation.commit((tx) => proposeWorkflow(tx, journal.conversation.id, "p:receipt", args), context);
    const first = await propose();
    expect(await propose()).toEqual(first);
    expect(await workflowProposals(journal.harness, journal.conversation.id, context)).toEqual([first]);
    await journal.project();
    await journal.project();
    expect(manager.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === "forgerie.workflow-proposal")).toHaveLength(1);
    const publications: string[][] = [];
    const unsubscribe = journal.harness.subscribeCommits((publication) => {
      const kinds = publication.changes.flatMap((change) => change.type === "document" && (change.record.kind === WORKFLOW_DOC_KIND || change.record.kind === WORKFLOW_PROPOSALS_DOC_KIND) ? [change.record.kind] : []);
      if (kinds.length > 0) publications.push(kinds.sort());
    });
    try {
      const run = await startWorkflowProposal(journal.harness, journal.conversation, directory, manager.getSessionId(), first.id, {}, "start-once", context);
      expect(publications).toContainEqual([WORKFLOW_PROPOSALS_DOC_KIND, WORKFLOW_DOC_KIND].sort());
      expect((await workflowProposals(journal.harness, journal.conversation.id, context))[0]?.state).toMatchObject({ kind: "started", runId: run.id });
      expect((await workflowRuns(journal.harness, journal.conversation.id, context))[0]?.definition).toEqual({ name: first.name, path: `proposal:${first.id}`, text: first.text, sha256: first.sha256 });
    } finally { unsubscribe(); }
  } finally { await journal.close(); await rm(directory, { recursive: true, force: true }); }
});


it("declares replay safety for native tools with committed receipts", () => {
  const extensions = [workflowExtension(), ...durableChildExtensions().parent];
  const policies = Object.fromEntries(extensions.flatMap(extension => extension.tools ?? []).map(tool => [tool.name, tool.replay]));
  expect(policies).toMatchObject({ propose_workflow: "safe", workflow_finish: "safe", workflow_stop: "safe", child_agent: "safe" });
});

it("offers one repair after a failed automatic land, and none after a second failure or at an approve stop", () => {
  const land = { id: "land", name: "Land", stop: "land" as const };
  expect(autoStopFailureAdvice(land, 1)).toContain("You may make one repair attempt first");
  expect(autoStopFailureAdvice(land, 1)).toContain('call workflow_stop for "land" again');
  for (const advice of [autoStopFailureAdvice(land, 2), autoStopFailureAdvice({ id: "contract", name: "Contract", stop: "approve" }, 1)]) {
    expect(advice).not.toContain("repair attempt first");
    expect(advice).toContain("Do not land, merge or push to the default branch yourself.");
    expect(advice).toMatch(/End your turn\.$/u);
  }
  expect(autoStopFailureAdvice(land, 2)).toContain("The one repair attempt is used.");
});

it("tells the repair agent that Land rebases each branch alone, in start order, and keeps only non-merge commits", () => {
  const advice = autoStopFailureAdvice({ id: "land", name: "Land", stop: "land" }, 1);
  expect(advice).toContain("Land rebases each branch alone onto the default branch, in the order the children started, and keeps only the non-merge commits.");
  expect(advice).toContain("A merge commit, or a fast-forward to a merge, does not repair a branch");
});

/** A repair child's completion report. It stays live until the test releases it, as a reporter does while its child works. */
let releaseReport: () => void = () => undefined;
const RepairReport = defineTask<null, { phase: "work" }, null>({
  name: "test.repair-report", version: 1, initial: () => ({ phase: "work" }),
  phases: { work: async (_task, runtime, context) => {
    await awaitWithContext(new Promise<void>((resolve) => { releaseReport = resolve; }), context);
    await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
  } },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

/** A run whose land stop waits while its child alpha still works on a repair. */
async function landWhileRepairing(run: (fixture: { journal: DurableSessionJournal; runId: string; reporter: Awaited<ReturnType<typeof startRepair>> }) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-workflow-land-wait-"));
  const manager = SessionManager.create(directory, directory);
  manager.appendMessage(fauxAssistantMessage("Prior context"));
  const models = createModels();
  const provider = fauxProvider();
  models.setProvider(provider.provider);
  provider.setResponses(Array.from({ length: 10 }, () => fauxAssistantMessage("Waiting.")));
  const registry = createRegistry();
  registry.install(workflowExtension());
  registry.install(defineExtension({ name: "test.repair", tasks: [RepairReport] }));
  const journal = await DurableSessionJournal.open({ manager, models, registry, agent: { model: { provider: "faux", modelId: "faux-1" } } });
  const parent = journal.conversation.id;
  const text = "---\nworkflow:\n  version: 1\n  stages:\n    - { id: build, name: Build }\n    - { id: land, name: Land, stop: land }\n---\nBuild, then land.\n";
  const proposal = await journal.conversation.commit((tx) => proposeWorkflow(tx, parent, "p:land", { name: "land-wait", summary: "Land after a repair.", text, basis: { kind: "new", reason: "Test." } }), context);
  const launched = await startWorkflowProposal(journal.harness, journal.conversation, directory, manager.getSessionId(), proposal.id, {}, "land-wait", context);
  await journal.conversation.commit((tx) => requestWorkflowStop(tx, parent, launched.id, "land", "Land the repaired branch."), context);
  const reporter = await startRepair(journal);
  try { await run({ journal, runId: launched.id, reporter }); }
  finally {
    await journal.harness.abortTask(reporter, context);
    await journal.close();
    await rm(directory, { recursive: true, force: true });
  }
}
async function startRepair(journal: DurableSessionJournal) {
  const parent = journal.conversation.id;
  const reporter = await journal.conversation.commit(async (tx) => {
    const child = await tx.createConversation({ ownership: { kind: "ownerless" } });
    const task = await tx.createTask(RepairReport, null, { ownership: { kind: "conversation" }, background: true });
    await associateWorkflowChild(tx, parent, child.id, task, "alpha");
    return task;
  }, context);
  journal.harness.resume();
  return reporter;
}

it.each(["user", "forgerie"] as const)("%s land waits for a working repair child's report, then lands", async (by) => {
  await landWhileRepairing(async ({ journal, runId, reporter }) => {
    const landedRuns: WorkflowRun[] = [];
    const land = async (run: WorkflowRun) => {
      // The report is in before Land touches a worktree.
      expect((await journal.harness.getTask(reporter, context))?.state.status).toBe("terminal");
      landedRuns.push(run);
      return { landed: ["c-alpha"] };
    };
    const decided = decideWorkflowStop(journal.harness, journal.conversation, runId, "land", "land", undefined, land, context, by);
    await sleep(200);
    expect(landedRuns).toEqual([]);
    releaseReport();
    const run = await decided;
    expect(landedRuns).toHaveLength(1);
    expect(run.stops?.["land"]).toMatchObject({ state: "approved", landed: ["c-alpha"] });
  });
});

it.each([
  ["user", /^Nothing landed\. Land waited 0 s for the report of alpha, and it is still working\. Land did not change any branch\. Click Land all again after alpha reports\.$/u],
  ["forgerie", /^Nothing landed\. Land waited 0 s for the report of alpha, and it is still working\. Land did not change any branch\.$/u],
] as const)("%s land fails and names the child when its report does not arrive in time", async (by, message) => {
  await landWhileRepairing(async ({ journal, runId }) => {
    let lands = 0;
    const land = () => { lands++; return Promise.resolve({ landed: [] }); };
    await expect(decideWorkflowStop(journal.harness, journal.conversation, runId, "land", "land", undefined, land, context, by, 50)).rejects.toThrow(message);
    expect(lands).toBe(0);
    const [run] = await workflowRuns(journal.harness, journal.conversation.id, context);
    expect(run?.stops?.["land"]?.state).toBe("waiting");
    expect(run?.children).toMatchObject([{ name: "alpha", state: { kind: "working" } }]);
  });
});
