import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRegistry } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { durableChildExtensions } from "./durableChildAgents.js";
import { DurableSessionJournal } from "./durableSessionJournal.js";
import { proposeWorkflow, startWorkflowProposal, workflowExtension, workflowProposals, workflowRuns, WORKFLOW_DOC_KIND, WORKFLOW_PROPOSALS_DOC_KIND } from "./durableWorkflowRuns.js";

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
    const args = { name: "one-task", summary: "Plan this task.", text: "---\nworkflow: {version: 1}\n---\nWait for review.\n" };
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
