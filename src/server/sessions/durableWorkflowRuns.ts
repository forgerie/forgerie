import { createHash } from "node:crypto";
import { AssistantEntry, defineDoc, defineExtension, defineTask, defineTool, InboxDoc, LiveDoc, type CommitPublication, type Conversation, type ConversationId, type Cursor, type Harness, type SubmissionRecord, type TaskId, type Tx } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";
import { WorkflowOutcomeSchema, WorkflowRunSchema, WORKFLOW_RETENTION_DAYS, type WorkflowInputs, type WorkflowOutcome, type WorkflowRun, type WorkflowStopDecision } from "../../shared/workflowRuns.js";
import { admitChild, completionProblem, stageForChild, stopOf, stopRequestProblem } from "../../shared/workflowStops.js";
import { assertProseOnly, WorkflowError, workflowInputs, workflowPrompt, type WorkflowLibrary } from "../resources/workflowLibrary.js";

export const WORKFLOW_DOC_KIND = "forgerie.workflow-runs";
const activeSchema = Type.Object({ active: Type.Union([Type.String(), Type.Null()]) });
export function workflowActiveFromCommit(publication: CommitPublication, parent: ConversationId): { active: string | null } | undefined {
  for (const change of publication.changes) {
    if (change.type === "document" && change.conversationId === parent && change.record.kind === WORKFLOW_DOC_KIND && Check(activeSchema, change.value)) {
      return { active: change.value.active };
    }
  }
  return undefined;
}
/** Whether a commit changed this parent's workflow records, so the browser refetches them. */
export function workflowRunsChanged(publication: CommitPublication, parent: ConversationId): boolean {
  return publication.changes.some((change) => change.type === "document" && change.conversationId === parent && change.record.kind === WORKFLOW_DOC_KIND);
}
/** The agent asked the user to decide at a stop. The transcript shows it as a card; the model does not see it. */
export const WORKFLOW_STOP_KIND = "forgerie.workflow-stop";
export const isWorkflowEntryKind = (kind: string): boolean => kind === WORKFLOW_STOP_KIND;
export function workflowEntryText(data: unknown): string {
  const record: Record<string, unknown> = typeof data === "object" && data !== null ? Object.fromEntries(Object.entries(data)) : {};
  const field = (key: string): string => { const value = record[key]; return typeof value === "string" ? value : ""; };
  return `${field("workflow")} waits for you at ${field("stageName")}: ${field("summary")}`;
}
const Runs = defineDoc<{ active: string | null; records: Record<string, WorkflowRun & { requestedInputs: WorkflowInputs }>; receipts?: Record<string, boolean> }>({
  kind: WORKFLOW_DOC_KIND, version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ active: null, records: {} }),
});

// A launch record and its delivery task commit together. Delivery retries use one Durable submission receipt.
// A stop decision reuses it with its own request ID, so each decision reaches the agent once.
const Launch = defineTask<{ runId: string; prompt: string; requestId?: string }, { phase: "deliver" }, null>({
  name: "forgerie.workflow-launch", version: 1, initial: () => ({ phase: "deliver" }),
  phases: { deliver: async (task, runtime, context) => {
    const parent = await runtime.conversation(runtime.conversationId, context);
    if (parent === undefined) throw new Error("Workflow parent is missing");
    await parent.submit({ type: "input", content: task.input.prompt, whenBusy: "followUp", requestId: task.input.requestId ?? `workflow:${task.input.runId}` }, context);
    await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
  } },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

const toolResult = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], ...(isError ? { isError: true } : {}) });
async function asTool(action: () => Promise<string>) {
  try { return toolResult(await action()); }
  catch (error) {
    if (!(error instanceof WorkflowError)) throw error;
    return toolResult(error.message, true);
  }
}

export function workflowExtension() {
  return defineExtension({ name: "forgerie.workflows", tasks: [Launch], tools: [defineTool({
    name: "workflow_finish", description: "Explicitly finish a prose workflow run. All its child work and completion reports must settle first. An idle pause does not finish a run. A run with stops finishes as completed only after the user passes every stop.",
    parameters: Type.Object({ runId: Type.String(), outcome: WorkflowOutcomeSchema, result: Type.String({ minLength: 1, maxLength: 65536 }) }, { additionalProperties: false }),
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
    replay: "safe", executionMode: "sequential",
    execute: (args, api, context) => asTool(() => api.commit((tx) => requestWorkflowStop(tx, api.conversationId, args.runId, args.stage, args.summary), context)),
  })] });
}

export async function requestWorkflowStop(tx: Tx, parent: ConversationId, runId: string, stageId: string, summary: string): Promise<string> {
  const doc = await tx.doc(Runs, parent);
  const run = doc.records[runId];
  if (run === undefined || doc.active !== runId) throw new WorkflowError(404, "No active workflow run with this id in this session");
  const stage = run.stages?.find((candidate) => candidate.id === stageId);
  const current = stopOf(run, stageId);
  // A replayed call, or a second ask for a stop already waiting, does not add another card.
  if (stage !== undefined && current.state === "waiting") return `Already waiting for the user at "${stage.name}". End your turn.`;
  await reconcileReportFailures(tx, parent, run);
  const problem = stopRequestProblem(run, stageId);
  if (problem !== undefined || stage?.stop === undefined) throw new WorkflowError(409, problem ?? "Not a stop");
  const round = current.round ?? 0;
  run.stops = { ...run.stops, [stageId]: { state: "waiting", summary, requestedAt: Date.now(), round } };
  await tx.appendEntry(parent, { kind: WORKFLOW_STOP_KIND, data: { runId, stage: stageId, stageName: stage.name, stop: stage.stop, summary, workflow: run.definition.name, round } });
  return `Waiting for the user at "${stage.name}". End your turn now. Their decision arrives as a new message; do not start later stages until then.`;
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

export async function launchWorkflow(harness: Harness, parent: Conversation, library: WorkflowLibrary, cwd: string, sessionId: string,
  name: string, supplied: WorkflowInputs, requestId: string, context: Context): Promise<WorkflowRun> {
  const id = createHash("sha256").update(`${sessionId}/${String(parent.id)}/${requestId}`).digest("hex");
  const stored = await harness.snapshot(Runs, parent.id, context);
  const existing = stored?.records[id];
  const sameRequest = (run: WorkflowRun & { requestedInputs: WorkflowInputs }) => {
    if (run.definition.name !== name || !sameInputs(run.requestedInputs, supplied)) throw new WorkflowError(409, "This workflow request ID already names another launch");
    return publicRun(run);
  };
  // A retry uses the accepted bytes and defaults, even if the file changed or was removed afterward.
  if (existing !== undefined) return sameRequest(existing);
  if (stored?.receipts?.[id] === true) throw new WorkflowError(409, "This workflow receipt expired; launch with a new requestId");
  const definition = await library.read(cwd, name);
  assertProseOnly(definition);
  const inputs = workflowInputs(definition.definition, supplied);
  const run = await parent.commit(async (tx) => {
    const doc = await tx.doc(Runs, parent.id);
    const found = doc.records[id];
    if (found !== undefined) return sameRequest(found);
    if (doc.receipts?.[id] === true) throw new WorkflowError(409, "This workflow receipt expired; launch with a new requestId");
    if (doc.active !== null) throw new WorkflowError(409, "Finish the active workflow before launching another in this session");
    await assertChildWorkSettled(tx, parent.id);
    const live = await tx.doc(LiveDoc, parent.id);
    const inbox = await tx.doc(InboxDoc, parent.id);
    if (live.run !== undefined || inbox.items.length > 0) throw new WorkflowError(409, "Wait for the parent to become idle before launching a workflow");
    const stages = definition.definition.stages;
    const run: WorkflowRun = { id, requestId, session: { id: sessionId, cwd }, startedAt: Date.now(), definition: { name, path: definition.path, text: definition.text, sha256: definition.sha256 }, inputs, state: { kind: "running" }, children: [],
      ...(stages === undefined ? {} : { stages, stops: Object.fromEntries(stages.flatMap((stage) => stage.stop === undefined ? [] : [[stage.id, { state: "open" as const, round: 0 }]])) }) };
    doc.records[id] = { ...run, requestedInputs: supplied };
    doc.receipts = { ...doc.receipts, [id]: true };
    doc.active = id;
    await tx.createTask(Launch, { runId: id, prompt: workflowPrompt(id, definition, inputs) }, { ownership: { kind: "conversation" }, background: true });
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

export async function finishWorkflow(tx: Tx, parent: ConversationId, runId: string, outcome: WorkflowOutcome, result: string): Promise<void> {
  if (result.trim() === "") throw new WorkflowError(400, "A workflow result is required");
  const doc = await tx.doc(Runs, parent);
  const run = doc.records[runId];
  if (run === undefined) throw new WorkflowError(404, "Workflow run not found in this session");
  if (run.state.kind === "finished") {
    if (run.state.outcome !== outcome || run.state.result !== result) throw new WorkflowError(409, "Workflow already finished with another result");
    return;
  }
  if (outcome === "completed") {
    const problem = completionProblem(run);
    if (problem !== undefined) throw new WorkflowError(409, problem);
  }
  await reconcileReportFailures(tx, parent, run);
  if (run.children.some((child) => child.state.kind === "working" || (!child.state.delivered && child.state.deliveryError === undefined))) throw new WorkflowError(409, "Wait for associated child work and reports before finishing the workflow");
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
  const admission = admitChild(run, name);
  return admission.kind === "refused" ? admission.reason : undefined;
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
export async function undeliveredWorkflowChild(tx: Tx, parent: ConversationId, reporter: TaskId, reason: string): Promise<void> {
  for (const child of await reporterChildren(tx, parent, reporter)) {
    if (child.state.kind === "settled") child.state.deliveryError = reason;
  }
}
async function submissionState(tx: Tx, submission: SubmissionRecord): Promise<WorkflowChild["state"]> {
  if (submission.type !== "input") throw new Error("Workflow child submission is not input");
  if (submission.status === "queued" || submission.status === "placed") return { kind: "working" };
  if (submission.status === "unanswered") return { kind: "settled", outcome: submission.reason === "aborted" ? "stopped" : "failed", result: submission.reason, delivered: false };
  const answer = (await tx.entry(AssistantEntry, submission.answer))?.model?.[0];
  if (answer?.role !== "assistant") throw new Error("Workflow child answer is missing");
  const result = answer.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
  return { kind: "settled", outcome: "answered", result, delivered: false };
}
export async function activeWorkflowRun(harness: Harness, parent: ConversationId, context: Context): Promise<string | undefined> {
  return (await harness.snapshot(Runs, parent, context))?.active ?? undefined;
}
const reporterIdSchema = Type.Unsafe<TaskId>(Type.Integer({ minimum: 1 }));
const childIdSchema = Type.Unsafe<ConversationId>(Type.Integer({ minimum: 1 }));
async function reconcileReportFailures(tx: Tx, parent: ConversationId, run: WorkflowRun): Promise<void> {
  for (const child of run.children) {
    if (child.state.kind === "settled" && (child.state.delivered || child.state.deliveryError !== undefined)) continue;
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
      const submission = await tx.submissionByRequest(conversationId, `child:${String(id)}`);
      child.state = submission === undefined ? { kind: "settled", outcome: "failed", result: reason, delivered: false }
        : await submissionState(tx, submission);
      if (child.state.kind === "working") continue;
    }
    // A crash/abort can occur after admission but before the delivery marker commits.
    if (await tx.submissionByRequest(parent, `child-report:${String(id)}`) !== undefined) child.state.delivered = true;
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
function publicRun(run: WorkflowRun & { requestedInputs?: WorkflowInputs }): WorkflowRun {
  const value = Object.fromEntries(Object.entries(run).filter(([key]) => key !== "requestedInputs"));
  // Doc drafts are transaction overlays. Materialize nested fields before the commit settles.
  const plain: unknown = JSON.parse(JSON.stringify(value));
  if (!Check(WorkflowRunSchema, plain)) throw new Error("Invalid workflow record");
  return plain;
}
function sameInputs(a: WorkflowInputs, b: WorkflowInputs): boolean {
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([name, value]) => Object.hasOwn(b, name) && b[name] === value);
}
