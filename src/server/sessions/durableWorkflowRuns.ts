import { createHash } from "node:crypto";
import { AssistantEntry, defineDoc, defineExtension, defineTask, defineTool, InboxDoc, LiveDoc, type CommitPublication, type Conversation, type ConversationId, type Cursor, type Harness, type SubmissionRecord, type TaskId, type Tx } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";
import { WorkflowOutcomeSchema, WorkflowModelSchema, WorkflowModelsSchema, WorkflowRunSchema, WORKFLOW_RETENTION_DAYS, type WorkflowChildDelivery, type WorkflowInputs, type WorkflowModels, type WorkflowOutcome, type WorkflowRun, type WorkflowStopDecision } from "../../shared/workflowRuns.js";
import { WorkflowProposalSchema, WorkflowProposalToolSchema, type WorkflowProposal, type WorkflowProposalTool } from "../../shared/workflowProposals.js";
import { admitChild, completionProblem, declaredWorker, stageForChild, stopOf, stopRequestProblem } from "../../shared/workflowStops.js";
import { assertProseOnly, parseWorkflow, WorkflowError, workflowInputs, workflowPrompt, type ProseWorkflow, type WorkflowInventory, type WorkflowLibrary } from "../resources/workflowLibrary.js";

export const WORKFLOW_DOC_KIND = "forgerie.workflow-runs";
export const WorkflowActiveSchema = Type.Object({ active: Type.Union([Type.String(), Type.Null()]) });
export function workflowActiveFromCommit(publication: CommitPublication, parent: ConversationId): { active: string | null } | undefined {
  for (const change of publication.changes) {
    if (change.type === "document" && change.conversationId === parent && change.record.kind === WORKFLOW_DOC_KIND && Check(WorkflowActiveSchema, change.value)) {
      return { active: change.value.active };
    }
  }
  return undefined;
}
/** Whether a commit changed this parent's workflow records, so the browser refetches them. */
export function workflowRunsChanged(publication: CommitPublication, parent: ConversationId): boolean {
  return publication.changes.some((change) => change.type === "document" && change.conversationId === parent && (change.record.kind === WORKFLOW_DOC_KIND || change.record.kind === WORKFLOW_PROPOSALS_DOC_KIND));
}
/** The agent asked the user to decide at a stop. The transcript shows it as a card; the model does not see it. */
export const WORKFLOW_STOP_KIND = "forgerie.workflow-stop";
export const WORKFLOW_PROPOSAL_KIND = "forgerie.workflow-proposal";
export const isWorkflowEntryKind = (kind: string): boolean => kind === WORKFLOW_STOP_KIND || kind === WORKFLOW_PROPOSAL_KIND;
export function workflowEntryText(kind: string, data: unknown): string {
  const record: Record<string, unknown> = typeof data === "object" && data !== null ? Object.fromEntries(Object.entries(data)) : {};
  const field = (key: string): string => { const value = record[key]; return typeof value === "string" ? value : ""; };
  if (kind === WORKFLOW_PROPOSAL_KIND) return `Proposed workflow ${field("name")}: ${field("summary")}`;
  return `${field("workflow")} waits for you at ${field("stageName")}: ${field("summary")}`;
}
const Runs = defineDoc<{ active: string | null; records: Record<string, WorkflowRun & { requestedInputs: WorkflowInputs; requestedModels?: WorkflowModels }>; receipts?: Record<string, boolean>; stopReceipts?: Record<string, string> }>({
  kind: WORKFLOW_DOC_KIND, version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ active: null, records: {} }),
});

export const WORKFLOW_PROPOSALS_DOC_KIND = "forgerie.workflow-proposals";
const Proposals = defineDoc<{ records: Record<string, WorkflowProposal> }>({
  kind: WORKFLOW_PROPOSALS_DOC_KIND, version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ records: {} }),
});

// A launch record and its delivery task commit together. Delivery retries use one Durable submission receipt.
// A stop decision reuses it with its own request ID, so each decision reaches the agent once.
const Launch = defineTask<{ runId: string; prompt: string; requestId?: string }, { phase: "deliver" }, null>({
  name: "forgerie.workflow-launch", version: 1, initial: () => ({ phase: "deliver" }),
  phases: { deliver: async (task, runtime, context) => {
    const parent = await runtime.conversation(runtime.conversationId, context);
    if (parent === undefined) throw new Error("Workflow parent is missing");
    const run = (await runtime.snapshot(Runs, runtime.conversationId, context))?.records[task.input.runId];
    if (run !== undefined && run.state.kind !== "running") {
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
      return;
    }
    await parent.submit({ type: "input", content: task.input.prompt, whenBusy: "followUp", requestId: task.input.requestId ?? `workflow:${task.input.runId}` }, context);
    await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
  } },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

/** Cancellation lives outside the target's ownership tree, so cancelling all background work cannot cancel itself. */
const Cancel = defineTask<{ parent: ConversationId; runId: string }, { phase: "cancel" }, null>({
  name: "forgerie.workflow-cancel", version: 1, initial: () => ({ phase: "cancel" }),
  phases: { cancel: async (task, runtime, context) => {
    const parent = await runtime.conversation(task.input.parent, context);
    if (parent === undefined) throw new Error("Workflow parent is missing");
    await parent.abort(context, { background: true });
    await runtime.commit(async (tx) => {
      const doc = await tx.doc(Runs, task.input.parent);
      const run = doc.records[task.input.runId];
      if (run?.state.kind !== "stopping") throw new Error("Workflow cancellation lost its stop request");
      await reconcileReportFailures(tx, task.input.parent, run);
      run.state = { kind: "finished", outcome: "stopped", result: "Stopped by the user. Files and commits were kept; completed actions were not undone.", finishedAt: Date.now() };
      if (doc.active === run.id) doc.active = null;
      await tx.appendEntry(task.input.parent, { kind: "forgerie.workflow-cancelled", model: [{ role: "user", content: `[workflow ${run.definition.name}] The user stopped the run. Do not resume it unless asked.`, timestamp: Date.now() }] });
      return { status: "terminal", outcome: { status: "completed", result: null } };
    }, context);
  } },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

/** One durable cancellation request per run. Returns immediately; the run stays active until all work stops. */
export async function cancelWorkflow(harness: Harness, parent: Conversation, runId: string, context: Context): Promise<WorkflowRun> {
  const run = await parent.commit(async (tx) => {
    const doc = await tx.doc(Runs, parent.id);
    const record = doc.records[runId];
    if (record === undefined) throw new WorkflowError(404, "Workflow run not found in this session");
    if (record.state.kind === "finished") {
      if (record.state.outcome !== "stopped") throw new WorkflowError(409, "This workflow has already finished");
      return publicRun(record);
    }
    if (record.state.kind === "stopping") return publicRun(record);
    if (doc.active !== runId) throw new WorkflowError(409, "This workflow is not active");
    record.state = { kind: "stopping" };
    const control = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await tx.createTask(Cancel, { parent: parent.id, runId }, { conversationId: control.id, ownership: { kind: "conversation" }, background: true });
    return publicRun(record);
  }, context);
  harness.resume();
  return run;
}

const toolResult = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], ...(isError ? { isError: true } : {}) });
async function asTool(action: () => Promise<string>) {
  try { return toolResult(await action()); }
  catch (error) {
    if (!(error instanceof WorkflowError)) throw error;
    return toolResult(error.message, true);
  }
}

const PROPOSE_WORKFLOW_GUIDANCE = [
  "Propose a plan for a task that is too large or too risky for you alone in this session, then end your turn. If you can do the task well yourself, do it instead of proposing.",
  "Call saved_workflows first and read any saved workflow that could fit. Adapt the closest one: keep its stages and agents, write this task's own instructions into its prose, and change its shape only when the task needs it. Say what you changed in basis. Write a new plan only when no saved workflow fits, and name the ones you considered in basis.",
  "Plan for the user's time. Use the fewest workers that do the job. Run independent work in parallel. Put a stage after another only when it needs the other's output. Do not set a worker's model unless the user asked for one: a worker without a model uses its agent file's model.",
  "Never write a workflow file into the repository. Supply complete prompt-format text with workflow version 1 frontmatter and prose, and pre-fill its inputs. A worker sees nothing of this chat, so the prose must carry the task's instructions. The user reads the prose beside the route and inputs; agents then follow it. Use the reply guide's rich blocks, including status checklists, steps and details where useful. Frontmatter description is a plain title of at most 90 characters; omit a duplicate H1. Give each input a short description as its label. Open with the outcome in two or three sentences. Use one H2 per stage, named exactly as the stage, in route order. State each stage's actions and acceptance checks; call out conditions that stop or roll back work. Put supporting instructions in details. Refer to input names, not copies of their values. Add no approve stops unless the user asked to check something. Only irreversible steps need a stop.",
  "Only the user decides: they start the plan with workers, have you do it here without workers, ask for changes, or dismiss it.",
].join(" ");

/** The user's saved workflows, for the agent: a list with routes, or one file in full. */
function savedWorkflowsText(inventory: WorkflowInventory, name?: string): string {
  if (name !== undefined) {
    const workflow = inventory.workflows.find((candidate) => candidate.name === name);
    if (workflow === undefined) throw new WorkflowError(404, `No saved workflow named ${name}. Saved: ${inventory.workflows.map((candidate) => candidate.name).join(", ") || "none"}.`);
    return `Saved workflow ${workflow.name} (${workflow.path}):\n\n${workflow.text}`;
  }
  if (inventory.workflows.length === 0) return "The user has no saved workflows. Write a new plan, and say so in basis.";
  const lines = inventory.workflows.map((workflow) => {
    const route = (workflow.definition.stages ?? []).map((stage) => {
      const workers = (stage.workers ?? []).map((worker) => worker.agent === undefined ? worker.name : `${worker.name}: ${worker.agent}`);
      return `${stage.name}${stage.stop === undefined ? "" : ` [stop: ${stage.stop}]`}${workers.length === 0 ? "" : ` (${workers.join(", ")})`}`;
    }).join(" -> ");
    return `- ${workflow.name}: ${workflow.description ?? "no description"}${route === "" ? "" : `\n  Route: ${route}`}`;
  });
  return `Saved workflows. Read one in full with saved_workflows and its name before you adapt it.\n${lines.join("\n")}`;
}

export function workflowExtension(options: { library?: WorkflowLibrary; cwd?: string } = {}) {
  const inventory = async (): Promise<WorkflowInventory> => options.library === undefined || options.cwd === undefined
    ? { workflows: [], diagnostics: [] } : options.library.list(options.cwd);
  return defineExtension({ name: "forgerie.workflows", tasks: [Launch, Cancel], tools: [defineTool({
    name: "saved_workflows",
    description: "List the user's saved workflows with their descriptions and routes, or read one in full by name. Call it before propose_workflow.",
    parameters: Type.Object({ name: Type.Optional(Type.String({ description: "A saved workflow to read in full." })) }, { additionalProperties: false }),
    // A read of the user's files. It changes nothing.
    replay: "safe", executionMode: "parallel",
    execute: async (args) => asTool(async () => savedWorkflowsText(await inventory(), args.name)),
  }), defineTool({
    name: "propose_workflow",
    description: PROPOSE_WORKFLOW_GUIDANCE,
    parameters: WorkflowProposalToolSchema,
    // The task-keyed proposal ID reuses the committed proposal and its card.
    replay: "safe", executionMode: "sequential",
    execute: (args, api, context) => asTool(async () => {
      const id = `p:${String(api.taskId)}`;
      const recorded = (await api.snapshot(Proposals, api.conversationId, context))?.records[id] !== undefined;
      const basis = args.basis;
      if (!recorded && basis.kind === "saved") {
        const { workflows } = await inventory();
        if (!workflows.some((workflow) => workflow.name === basis.name)) {
          throw new WorkflowError(404, `No saved workflow named ${basis.name}. Saved: ${workflows.map((workflow) => workflow.name).join(", ") || "none"}.`);
        }
      }
      await api.commit((tx) => proposeWorkflow(tx, api.conversationId, id, args), context);
      return `Proposed workflow "${args.name}". End your turn now. The user starts it, asks for changes, or dismisses it; do not start it yourself or write a workflow file.`;
    }),
  }), defineTool({
    name: "workflow_finish", description: "Explicitly finish a prose workflow run. All its child work and completion reports must settle first. An idle pause does not finish a run. A run with stops finishes as completed only after the user passes every stop.",
    parameters: Type.Object({ runId: Type.String(), outcome: WorkflowOutcomeSchema, result: Type.String({ minLength: 1, maxLength: 65536 }) }, { additionalProperties: false }),
    // The stored terminal outcome is the receipt; replay with the same result is a no-op.
    replay: "safe", executionMode: "sequential",
    execute: (args, api, context) => asTool(async () => {
      await api.commit((tx) => finishWorkflow(tx, api.conversationId, args.runId, args.outcome, args.result), context);
      return `Workflow ${args.runId} finished: ${args.outcome}.`;
    }),
  }), defineTool({
    name: "workflow_stop",
    description: "Ask the user to decide at a workflow stop: a stage the route marks as the user's. Call it when the work for that stop is ready, then end your turn. The run holds there; the decision arrives as a new message.",
    parameters: Type.Object({
      runId: Type.String(),
      stage: Type.String({ description: "The stop stage id from the route." }),
      summary: Type.String({ minLength: 1, maxLength: 4000, description: "What the user decides on, in a few sentences. Name files or branches when they matter." }),
    }, { additionalProperties: false }),
    // A task-keyed stop receipt prevents replay from asking again after a user decision.
    replay: "safe", executionMode: "sequential",
    execute: (args, api, context) => asTool(() => api.commit((tx) => requestWorkflowStop(tx, api.conversationId, args.runId, args.stage, args.summary, api.taskId), context)),
  })] });
}

export async function requestWorkflowStop(tx: Tx, parent: ConversationId, runId: string, stageId: string, summary: string, taskId?: TaskId): Promise<string> {
  const doc = await tx.doc(Runs, parent);
  const key = taskId === undefined ? undefined : String(taskId);
  const receipt = key === undefined ? undefined : doc.stopReceipts?.[key];
  // The user may reopen/approve the stop before recovery. A waiting-state guard alone would ask again.
  if (receipt !== undefined) return receipt;
  const remember = (text: string): string => {
    if (key !== undefined) doc.stopReceipts = { ...doc.stopReceipts, [key]: text };
    return text;
  };
  const run = doc.records[runId];
  if (run === undefined || doc.active !== runId) throw new WorkflowError(404, "No active workflow run with this id in this session");
  if (run.state.kind !== "running") throw new WorkflowError(409, "This workflow is stopping or finished");
  const stage = run.stages?.find((candidate) => candidate.id === stageId);
  const current = stopOf(run, stageId);
  // A replayed call, or a second ask for a stop already waiting, does not add another card.
  if (stage !== undefined && current.state === "waiting") return remember(`Already waiting for the user at "${stage.name}". End your turn.`);
  await reconcileReportFailures(tx, parent, run);
  const problem = stopRequestProblem(run, stageId);
  if (problem !== undefined || stage?.stop === undefined) throw new WorkflowError(409, problem ?? "Not a stop");
  const round = current.round ?? 0;
  run.stops = { ...run.stops, [stageId]: { state: "waiting", summary, requestedAt: Date.now(), round } };
  await tx.appendEntry(parent, { kind: WORKFLOW_STOP_KIND, data: { runId, stage: stageId, stageName: stage.name, stop: stage.stop, summary, workflow: run.definition.name, round } });
  return remember(`Waiting for the user at "${stage.name}". End your turn now. Their decision arrives as a new message; do not start later stages until then.`);
}

/**
 * The user's decision at a stop. One commit records it and creates the delivery task, so the agent hears each
 * decision exactly once. A land decision runs `land` first: it lands the children's branches in order and returns
 * their names. A failure leaves the stop waiting and keeps the branches that did land.
 */
export async function decideWorkflowStop(harness: Harness, parent: Conversation, runId: string, stageId: string, decision: WorkflowStopDecision,
  note: string | undefined, land: (run: WorkflowRun) => Promise<{ landed: string[]; error?: string }>, context: Context): Promise<WorkflowRun> {
  const snapshot = (await harness.snapshot(Runs, parent.id, context))?.records[runId];
  if (snapshot === undefined) throw new WorkflowError(404, "Workflow run not found in this session");
  const stage = snapshot.stages?.find((candidate) => candidate.id === stageId);
  if (stage?.stop === undefined) throw new WorkflowError(404, "This workflow has no stop with that id");
  if (snapshot.state.kind !== "running") throw new WorkflowError(409, "This workflow has finished");
  if (stopOf(snapshot, stageId).state !== "waiting") throw new WorkflowError(409, `"${stage.name}" is not waiting for a decision`);
  const trimmed = note?.trim() ?? "";
  if (decision === "changes" && trimmed === "") throw new WorkflowError(400, "Say what to change");
  if (decision === "approve" && stage.stop !== "approve") throw new WorkflowError(409, `"${stage.name}" is a land stop; land the branches instead`);
  if (decision === "land" && stage.stop !== "land") throw new WorkflowError(409, `"${stage.name}" is not a land stop`);
  const landing = decision === "land" ? await land(publicRun(snapshot)) : undefined;
  const run = await parent.commit(async (tx) => {
    const doc = await tx.doc(Runs, parent.id);
    const record = doc.records[runId];
    if (record === undefined) throw new WorkflowError(404, "Workflow run not found in this session");
    if (record.state.kind !== "running") throw new WorkflowError(409, "This workflow is stopping or finished");
    const current = stopOf(record, stageId);
    if (current.state !== "waiting") throw new WorkflowError(409, `"${stage.name}" is not waiting for a decision`);
    const round = (current.round ?? 0) + 1;
    const landed = [...(current.landed ?? []), ...(landing?.landed ?? [])];
    if (landing?.error !== undefined) {
      record.stops = { ...record.stops, [stageId]: { ...current, landed } };
      return { error: landing.error };
    }
    const decidedAt = Date.now();
    record.stops = { ...record.stops, [stageId]: decision === "changes"
      ? { state: "open", note: trimmed, decidedAt, round, ...(landed.length === 0 ? {} : { landed }) }
      : { state: "approved", ...(current.summary === undefined ? {} : { summary: current.summary }), ...(trimmed === "" ? {} : { note: trimmed }), decidedAt, round, ...(landed.length === 0 ? {} : { landed }) } };
    const prefix = `[workflow ${record.definition.name}]`;
    const prompt = decision === "changes" ? `${prefix} The user asked for changes at "${stage.name}": ${trimmed}\nRevise, then call workflow_stop for "${stageId}" again.`
      : decision === "land" ? `${prefix} The user landed ${landed.length === 0 ? "no branches (none had commits)" : `${String(landed.length)} branches on the default branch: ${landed.join(", ")}`}.${trimmed === "" ? "" : ` Note: ${trimmed}`}\nEvery stop has passed. Finish the workflow with workflow_finish.`
        : `${prefix} The user approved "${stage.name}".${trimmed === "" ? "" : ` Note: ${trimmed}`}\nContinue with the next stage.`;
    await tx.createTask(Launch, { runId, prompt, requestId: `workflow-stop:${runId}:${stageId}:${String(round)}` }, { ownership: { kind: "conversation" }, background: true });
    // Doc drafts are transaction overlays; materialize the record before the commit settles.
    return { record: publicRun(record) };
  }, context);
  harness.resume();
  if ("error" in run) throw new WorkflowError(409, run.error);
  return run.record;
}

export async function proposeWorkflow(tx: Tx, parent: ConversationId, id: string, args: WorkflowProposalTool): Promise<WorkflowProposal> {
  const doc = await tx.doc(Proposals, parent);
  // A retried Durable tool task must not replace its own card or append another entry.
  const existing = doc.records[id];
  if (existing !== undefined) return publicProposal(existing);
  if (!Check(WorkflowProposalToolSchema, args) || args.summary.trim() === "") throw new WorkflowError(400, "Invalid workflow proposal");
  const runs = await tx.doc(Runs, parent);
  if (runs.active !== null) throw new WorkflowError(409, "Finish the active workflow before proposing another in this session");
  let resolved: ProseWorkflow;
  try { resolved = parseWorkflow(args.name, `proposal:${id}`, args.text); }
  catch (error) { throw error instanceof WorkflowError ? error : new WorkflowError(400, error instanceof Error ? error.message : String(error)); }
  assertProseOnly(resolved);
  const inputs = workflowInputs(resolved.definition, args.inputs ?? {});
  const createdAt = Date.now();
  const proposal: WorkflowProposal = { id, name: args.name, summary: args.summary.trim(), text: resolved.text, sha256: resolved.sha256,
    createdAt, definition: resolved.definition, inputs, state: { kind: "open" }, basis: args.basis };
  for (const earlier of Object.values(doc.records)) if (earlier.state.kind === "open") earlier.state = { kind: "replaced", by: id, decidedAt: createdAt };
  doc.records[id] = proposal;
  await tx.appendEntry(parent, { kind: WORKFLOW_PROPOSAL_KIND, data: { proposalId: id, name: proposal.name, summary: proposal.summary, stages: proposal.definition.stages ?? [], basis: args.basis } });
  return proposal;
}

export async function workflowProposals(harness: Harness, parent: ConversationId, context: Context): Promise<WorkflowProposal[]> {
  const doc = await harness.snapshot(Proposals, parent, context);
  return Object.values(doc?.records ?? {}).map(publicProposal).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}
export async function openWorkflowProposals(harness: Harness, parent: ConversationId, context: Context): Promise<number> {
  const doc = await harness.snapshot(Proposals, parent, context);
  return Object.values(doc?.records ?? {}).filter((proposal) => proposal.state.kind === "open").length;
}

export async function decideWorkflowProposal(harness: Harness, parent: Conversation, id: string, decision: "changes" | "dismissed",
  note: string | undefined, context: Context): Promise<WorkflowProposal> {
  const trimmed = note?.trim() ?? "";
  if (decision === "changes" && trimmed === "") throw new WorkflowError(400, "Say what to change");
  const proposal = await parent.commit(async (tx) => {
    const doc = await tx.doc(Proposals, parent.id);
    const record = requireOpenProposal(doc.records[id]);
    const decidedAt = Date.now();
    record.state = decision === "changes" ? { kind: "changes", note: trimmed, decidedAt } : { kind: "dismissed", decidedAt };
    if (decision === "changes") {
      const prompt = `[workflow ${record.name}] The user asked for changes to the proposal: ${trimmed}\nRevise it, then call propose_workflow again.`;
      await tx.createTask(Launch, { runId: id, prompt, requestId: `workflow-proposal:${id}:changes` }, { ownership: { kind: "conversation" }, background: true });
    }
    return publicProposal(record);
  }, context);
  if (decision === "changes") harness.resume();
  return proposal;
}

/** The agent's instruction when the user has it follow a proposal itself. Stops become questions in the chat. */
function hereWorkflowPrompt(proposal: Pick<WorkflowProposal, "name">, workflow: ProseWorkflow, inputs: WorkflowInputs): string {
  const stops = (workflow.definition.stages ?? []).filter((stage) => stage.stop !== undefined).map((stage) => stage.name);
  return [
    `[workflow ${proposal.name}] The user chose to do this plan here, without child agents.`,
    "Do the work yourself in this session, stage by stage, as the plan below says. Do not start or message child agents; where the plan gives work to a worker, do that work yourself.",
    stops.length === 0 ? "There is no workflow run, so do not call workflow_stop or workflow_finish."
      : `There is no workflow run, so do not call workflow_stop or workflow_finish. At each stop (${stops.join(", ")}), ask the user in your reply and end your turn.`,
    `\nWorkflow inputs (JSON):\n${JSON.stringify(inputs)}\n\n${workflow.body}`,
  ].join(" ");
}

/** The user has the agent follow an open proposal itself: one commit closes the card and queues the instruction. */
export async function doWorkflowProposalHere(harness: Harness, parent: Conversation, id: string, supplied: WorkflowInputs, context: Context): Promise<WorkflowProposal> {
  const proposal = await parent.commit(async (tx) => {
    const doc = await tx.doc(Proposals, parent.id);
    const record = requireOpenProposal(doc.records[id]);
    if ((await tx.doc(Runs, parent.id)).active !== null) throw new WorkflowError(409, "Finish the active workflow before doing another plan here");
    // This is a storage read, never a library or filesystem read, as for Start.
    const workflow = parseWorkflow(record.name, `proposal:${id}`, record.text);
    const inputs = workflowInputs(workflow.definition, supplied);
    record.state = { kind: "here", decidedAt: Date.now() };
    await tx.createTask(Launch, { runId: id, prompt: hereWorkflowPrompt(record, workflow, inputs), requestId: `workflow-proposal:${id}:here` },
      { ownership: { kind: "conversation" }, background: true });
    return publicProposal(record);
  }, context);
  harness.resume();
  return proposal;
}

export async function startWorkflowProposal(harness: Harness, parent: Conversation, cwd: string, sessionId: string, id: string,
  supplied: WorkflowInputs, requestId: string, context: Context, models?: WorkflowModels): Promise<WorkflowRun> {
  const proposal = (await harness.snapshot(Proposals, parent.id, context))?.records[id];
  if (proposal === undefined) throw new WorkflowError(404, "Workflow proposal not found in this session");
  // This is a storage read, never a library or filesystem read. The original bytes are the run's source.
  const definition = parseWorkflow(proposal.name, `proposal:${id}`, proposal.text);
  return launchResolvedWorkflow(harness, parent, definition, cwd, sessionId, supplied, requestId, context, models, id);
}

function requireOpenProposal(proposal: WorkflowProposal | undefined): WorkflowProposal {
  if (proposal === undefined) throw new WorkflowError(404, "Workflow proposal not found in this session");
  if (proposal.state.kind !== "open") throw new WorkflowError(409, "This workflow proposal is not open");
  return proposal;
}
function publicProposal(proposal: WorkflowProposal): WorkflowProposal {
  const plain: unknown = JSON.parse(JSON.stringify(proposal));
  if (!Check(WorkflowProposalSchema, plain)) throw new Error("Invalid workflow proposal record");
  return plain;
}
function launchId(sessionId: string, parent: ConversationId, requestId: string): string {
  return createHash("sha256").update(`${sessionId}/${String(parent)}/${requestId}`).digest("hex");
}
function sameLaunch(run: WorkflowRun & { requestedInputs: WorkflowInputs; requestedModels?: WorkflowModels }, name: string, supplied: WorkflowInputs, models: WorkflowModels | undefined, path?: string): WorkflowRun {
  if (run.definition.name !== name || (path !== undefined && run.definition.path !== path) || !sameInputs(run.requestedInputs, supplied) || !sameInputs(run.requestedModels ?? {}, models ?? {})) {
    throw new WorkflowError(409, "This workflow request ID already names another launch");
  }
  return publicRun(run);
}

export async function launchWorkflow(harness: Harness, parent: Conversation, library: WorkflowLibrary, cwd: string, sessionId: string,
  name: string, supplied: WorkflowInputs, requestId: string, context: Context, models?: WorkflowModels): Promise<WorkflowRun> {
  const id = launchId(sessionId, parent.id, requestId);
  const stored = await harness.snapshot(Runs, parent.id, context);
  const existing = stored?.records[id];
  // A retry uses the accepted bytes and defaults, even if the file changed or was removed afterward.
  if (existing !== undefined) {
    if (existing.definition.path.startsWith("proposal:")) throw new WorkflowError(409, "This workflow request ID already names another launch");
    return sameLaunch(existing, name, supplied, models);
  }
  if (stored?.receipts?.[id] === true) throw new WorkflowError(409, "This workflow receipt expired; launch with a new requestId");
  return launchResolvedWorkflow(harness, parent, await library.read(cwd, name), cwd, sessionId, supplied, requestId, context, models);
}

async function launchResolvedWorkflow(harness: Harness, parent: Conversation, definition: ProseWorkflow, cwd: string, sessionId: string,
  supplied: WorkflowInputs, requestId: string, context: Context, models?: WorkflowModels, proposalId?: string): Promise<WorkflowRun> {
  const id = launchId(sessionId, parent.id, requestId);
  const run = await parent.commit(async (tx) => {
    const doc = await tx.doc(Runs, parent.id);
    const found = doc.records[id];
    if (found !== undefined) return sameLaunch(found, definition.name, supplied, models, definition.path);
    if (doc.receipts?.[id] === true) throw new WorkflowError(409, "This workflow receipt expired; launch with a new requestId");
    const proposal = proposalId === undefined ? undefined : requireOpenProposal((await tx.doc(Proposals, parent.id)).records[proposalId]);
    assertProseOnly(definition);
    const inputs = workflowInputs(definition.definition, supplied);
    if (models !== undefined && !Check(WorkflowModelsSchema, models)) throw new WorkflowError(400, "Invalid workflow worker models");
    for (const name of Object.keys(models ?? {})) {
      if (declaredWorker(definition.definition, name) === undefined) throw new WorkflowError(400, `Unknown workflow worker ${name}`);
    }
    if (doc.active !== null) throw new WorkflowError(409, "Finish the active workflow before launching another in this session");
    await assertChildWorkSettled(tx, parent.id);
    const live = await tx.doc(LiveDoc, parent.id);
    const inbox = await tx.doc(InboxDoc, parent.id);
    if (live.run !== undefined || inbox.items.length > 0) throw new WorkflowError(409, "Wait for the parent to become idle before launching a workflow");
    const stages = definition.definition.stages?.map((stage) => ({ ...stage, ...(stage.workers === undefined ? {} : {
      workers: stage.workers.map((worker) => {
        const model = models !== undefined && Object.hasOwn(models, worker.name) ? models[worker.name] : undefined;
        return model === undefined ? { ...worker } : { ...worker, model };
      }),
    }) }));
    const run: WorkflowRun = { id, requestId, session: { id: sessionId, cwd }, startedAt: Date.now(),
      definition: { name: definition.name, path: definition.path, text: definition.text, sha256: definition.sha256 }, inputs, state: { kind: "running" }, children: [],
      ...(stages === undefined ? {} : { stages, stops: Object.fromEntries(stages.flatMap((stage) => stage.stop === undefined ? [] : [[stage.id, { state: "open" as const, round: 0 }]])) }) };
    // Retry identity uses the accepted request, not stages: the user can change worker models during the run.
    doc.records[id] = { ...run, requestedInputs: supplied, ...(models === undefined ? {} : { requestedModels: models }) };
    doc.receipts = { ...doc.receipts, [id]: true };
    doc.active = id;
    if (proposal !== undefined) proposal.state = { kind: "started", runId: id, decidedAt: run.startedAt };
    await tx.createTask(Launch, { runId: id, prompt: workflowPrompt(id, { ...definition, definition: { ...definition.definition, ...(stages === undefined ? {} : { stages }) } }, inputs) }, { ownership: { kind: "conversation" }, background: true });
    return run;
  }, context);
  harness.resume();
  return run;
}

export async function workflowRuns(harness: Harness, parent: ConversationId, context: Context): Promise<WorkflowRun[]> {
  return harness.commit(async (tx) => {
    const doc = await tx.doc(Runs, parent);
    for (const run of Object.values(doc.records)) if (run.state.kind === "running") await reconcileReportFailures(tx, parent, run);
    const cutoff = Date.now() - WORKFLOW_RETENTION_DAYS * 86_400_000;
    doc.records = Object.fromEntries(Object.entries(doc.records).filter(([, run]) => run.state.kind !== "finished" || run.state.finishedAt > cutoff));
    return Object.values(doc.records).map(publicRun).sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id));
  }, context);
}

/** A route edit changes only the declaration. Children apply it at their next spawn or send. */
export async function setWorkflowWorkerModel(tx: Tx, parent: ConversationId, runId: string, name: string, model: string | null): Promise<WorkflowRun> {
  if (!Check(WorkflowModelSchema, model)) throw new WorkflowError(400, "Invalid workflow worker model");
  const run = (await tx.doc(Runs, parent)).records[runId];
  if (run === undefined) throw new WorkflowError(404, "Workflow run not found in this session");
  const worker = declaredWorker(run, name);
  if (worker === undefined) throw new WorkflowError(404, "Workflow worker not found in this run");
  if (run.state.kind !== "running") throw new WorkflowError(409, "This workflow has finished");
  worker.model = model;
  return publicRun(run);
}

export async function finishWorkflow(tx: Tx, parent: ConversationId, runId: string, outcome: WorkflowOutcome, result: string): Promise<void> {
  if (result.trim() === "") throw new WorkflowError(400, "A workflow result is required");
  const doc = await tx.doc(Runs, parent);
  const run = doc.records[runId];
  if (run === undefined) throw new WorkflowError(404, "Workflow run not found in this session");
  if (run.state.kind === "finished") {
    if (run.state.outcome !== outcome || run.state.result !== result) throw new WorkflowError(409, "Workflow already finished with another result");
    return;
  }
  if (run.state.kind === "stopping") throw new WorkflowError(409, "This workflow is stopping");
  if (outcome === "completed") {
    const problem = completionProblem(run);
    if (problem !== undefined) throw new WorkflowError(409, problem);
  }
  await reconcileReportFailures(tx, parent, run);
  if (run.children.some((child) => child.state.kind === "working" || (child.state.delivered === false && child.state.deliveryError === undefined))) throw new WorkflowError(409, "Wait for associated child work and reports before finishing the workflow");
  await assertChildWorkSettled(tx, parent);
  run.state = { kind: "finished", outcome, result, finishedAt: Date.now() };
  doc.active = null;
}

/**
 * Whether the agent may start or message this child now. The child tool asks before it prepares a worktree and again
 * in the commit that allocates the reporter. User actions (continuing a child from its view) are not held.
 */
export async function workflowChildRefusal(tx: Tx, parent: ConversationId, name: string): Promise<string | undefined> {
  const doc = await tx.doc(Runs, parent);
  const run = doc.active === null ? undefined : doc.records[doc.active];
  if (run === undefined) return undefined;
  if (run.state.kind !== "running") return "This workflow is stopping; do not start or message workers.";
  const admission = admitChild(run, name);
  return admission.kind === "refused" ? admission.reason : undefined;
}

/** The active workflow's model choice. Spawns and sends enforce it; null restores the agent file's model, else the session's. */
export async function workflowWorkerModel(tx: Tx, parent: ConversationId, name: string): Promise<string | null | undefined> {
  const doc = await tx.doc(Runs, parent);
  const run = doc.active === null ? undefined : doc.records[doc.active];
  if (run?.state.kind === "stopping") throw new WorkflowError(409, "This workflow is stopping; wait before messaging workers");
  return run === undefined ? undefined : declaredWorker(run, name)?.model;
}

/** Called in the same commit that allocates a reporter, so association cannot be lost after a crash. */
export async function associateWorkflowChild(tx: Tx, parent: ConversationId, child: ConversationId, reporter: TaskId, name: string): Promise<string | undefined> {
  const doc = await tx.doc(Runs, parent);
  const run = doc.active === null ? undefined : doc.records[doc.active];
  if (run === undefined) return undefined;
  const stage = stageForChild(run, name);
  run.children.push({ conversationId: Number(child), reporterId: Number(reporter), name, ...(stage === undefined ? {} : { stage: stage.id }), state: { kind: "working" } });
  return run.id;
}

type WorkflowChild = WorkflowRun["children"][number];
async function reporterChildren(tx: Tx, parent: ConversationId, reporter: TaskId): Promise<WorkflowChild[]> {
  const doc = await tx.doc(Runs, parent);
  return Object.values(doc.records).flatMap((run) => run.children.filter((child) => child.reporterId === Number(reporter)));
}
export async function settleWorkflowChild(tx: Tx, parent: ConversationId, reporter: TaskId, submission: SubmissionRecord): Promise<void> {
  for (const child of await reporterChildren(tx, parent, reporter)) child.state = await submissionState(tx, submission);
}
export async function deliveredWorkflowChild(tx: Tx, parent: ConversationId, reporter: TaskId): Promise<void> {
  for (const child of await reporterChildren(tx, parent, reporter)) {
    if (child.state.kind === "settled") child.state.delivered = true;
  }
}
export async function undeliveredWorkflowChild(tx: Tx, parent: ConversationId, reporter: TaskId, reason: Exclude<WorkflowChildDelivery, boolean>): Promise<void> {
  for (const child of await reporterChildren(tx, parent, reporter)) {
    if (child.state.kind === "working") child.state = { kind: "settled", outcome: "stopped", result: "aborted", delivered: reason };
    else child.state.delivered = reason;
  }
}
async function submissionState(tx: Tx, submission: SubmissionRecord): Promise<WorkflowChild["state"]> {
  if (submission.type !== "input") throw new Error("Workflow child submission is not input");
  if (submission.status === "queued" || submission.status === "placed") return { kind: "working" };
  if (submission.status === "unanswered") return { kind: "settled", outcome: submission.reason === "aborted" ? "stopped" : "failed", result: submission.detail === undefined ? submission.reason : typeof submission.detail === "string" ? submission.detail : JSON.stringify(submission.detail), delivered: false };
  const answer = (await tx.entry(AssistantEntry, submission.answer))?.model?.[0];
  if (answer?.role !== "assistant") throw new Error("Workflow child answer is missing");
  const result = answer.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
  return { kind: "settled", outcome: "answered", result, delivered: false };
}
/** Stops of the active run that wait for the user's decision. */
export async function waitingWorkflowStops(harness: Harness, parent: ConversationId, context: Context): Promise<number> {
  const doc = await harness.snapshot(Runs, parent, context);
  const run = doc?.active == null ? undefined : doc.records[doc.active];
  return run?.state.kind === "running" ? Object.values(run.stops ?? {}).filter((stop) => stop.state === "waiting").length : 0;
}
export async function activeWorkflowRunInTx(tx: Tx, parent: ConversationId): Promise<string | undefined> {
  return (await tx.doc(Runs, parent)).active ?? undefined;
}
export async function activeWorkflowRun(harness: Harness, parent: ConversationId, context: Context): Promise<string | undefined> {
  return (await harness.snapshot(Runs, parent, context))?.active ?? undefined;
}
const reporterIdSchema = Type.Unsafe<TaskId>(Type.Integer({ minimum: 1 }));
const childIdSchema = Type.Unsafe<ConversationId>(Type.Integer({ minimum: 1 }));
async function reconcileReportFailures(tx: Tx, parent: ConversationId, run: WorkflowRun): Promise<void> {
  for (const child of run.children) {
    if (child.state.kind === "settled" && (child.state.delivered !== false || child.state.deliveryError !== undefined)) continue;
    const id = child.reporterId;
    if (!Check(reporterIdSchema, id)) throw new Error("Invalid workflow reporter identity");
    const reporter = await tx.task(id);
    if (reporter?.state.status !== "terminal") continue;
    const outcome = reporter.state.outcome;
    const detail = outcome.error?.message ?? outcome.reason;
    const reason = `Completion reporter ${outcome.status}${detail === undefined ? "; inspect the child transcript." : `: ${detail}`}`;
    // Recover the admitted request, not the child's latest turn or the reporter's outcome.
    if (child.state.kind === "working") {
      const conversationId = child.conversationId;
      if (!Check(childIdSchema, conversationId)) throw new Error("Invalid workflow child identity");
      // The reporter may fail after a retry input rather than after the original admitted request.
      let submission: SubmissionRecord | undefined;
      for (const request of [3, 2, 1, 0]) {
        submission = await tx.submissionByRequest(conversationId, request === 0 ? `child:${String(id)}` : `child:${String(id)}:retry:${String(request)}`);
        if (submission !== undefined) break;
      }
      child.state = submission === undefined ? { kind: "settled", outcome: "failed", result: reason, delivered: false }
        : await submissionState(tx, submission);
      if (child.state.kind === "working") continue;
    }
    // A crash/abort can occur after admission but before the delivery marker commits.
    if (await tx.submissionByRequest(parent, `child-report:${String(id)}`) !== undefined) child.state.delivered = true;
    else if (outcome.status === "aborted") child.state.delivered = "aborted";
    else child.state.deliveryError = reason;
  }
}
async function assertChildWorkSettled(tx: Tx, parent: ConversationId): Promise<void> {
  for (const status of ["pending", "running", "waiting", "completing"] as const) {
    let cursor: Cursor | undefined;
    do {
      const page = await tx.scanTasks({ status }, 100, cursor);
      if (page.items.some((task) => task.conversationId !== parent || task.kind === "forgerie.child-reporter" || task.kind === "forgerie.workflow-launch")) {
        throw new WorkflowError(409, "Wait for child work, reports, and workflow launch delivery to settle");
      }
      cursor = page.next;
    } while (cursor !== undefined);
  }
}
function publicRun(run: WorkflowRun & { requestedInputs?: WorkflowInputs; requestedModels?: WorkflowModels }): WorkflowRun {
  const value = Object.fromEntries(Object.entries(run).filter(([key]) => key !== "requestedInputs" && key !== "requestedModels"));
  // Doc drafts are transaction overlays. Materialize nested fields before the commit settles.
  const plain: unknown = JSON.parse(JSON.stringify(value));
  if (!Check(WorkflowRunSchema, plain)) throw new Error("Invalid workflow record");
  return plain;
}
function sameInputs(a: Record<string, string | number | boolean | null>, b: Record<string, string | number | boolean | null>): boolean {
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([name, value]) => Object.hasOwn(b, name) && b[name] === value);
}
