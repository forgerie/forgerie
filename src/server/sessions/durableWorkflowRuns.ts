import { createHash } from "node:crypto";
import { defineDoc, defineExtension, defineTask, defineTool, InboxDoc, LiveDoc, type CommitPublication, type Conversation, type ConversationId, type Cursor, type Harness, type TaskId, type Tx } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";
import { WorkflowOutcomeSchema, WorkflowRunSchema, WORKFLOW_RETENTION_DAYS, type WorkflowInputs, type WorkflowOutcome, type WorkflowRun } from "../../shared/workflowRuns.js";
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
const Runs = defineDoc<{ active: string | null; records: Record<string, WorkflowRun & { requestedInputs: WorkflowInputs }>; receipts?: Record<string, boolean> }>({
  kind: WORKFLOW_DOC_KIND, version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ active: null, records: {} }),
});

// A launch record and its delivery task commit together. Delivery retries use one Durable submission receipt.
const Launch = defineTask<{ runId: string; prompt: string }, { phase: "deliver" }, null>({
  name: "forgerie.workflow-launch", version: 1, initial: () => ({ phase: "deliver" }),
  phases: { deliver: async (task, runtime, context) => {
    const parent = await runtime.conversation(runtime.conversationId, context);
    if (parent === undefined) throw new Error("Workflow parent is missing");
    await parent.submit({ type: "input", content: task.input.prompt, whenBusy: "followUp", requestId: `workflow:${task.input.runId}` }, context);
    await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
  } },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

export function workflowExtension() {
  return defineExtension({ name: "forgerie.workflows", tasks: [Launch], tools: [defineTool({
    name: "workflow_finish", description: "Explicitly finish a prose workflow run. All its child work and completion reports must settle first. An idle pause does not finish a run.",
    parameters: Type.Object({ runId: Type.String(), outcome: WorkflowOutcomeSchema, result: Type.String({ minLength: 1, maxLength: 65536 }) }, { additionalProperties: false }),
    replay: "safe", executionMode: "sequential",
    execute: async (args, api, context) => {
      try {
        await api.commit((tx) => finishWorkflow(tx, api.conversationId, args.runId, args.outcome, args.result), context);
        return { content: [{ type: "text" as const, text: `Workflow ${args.runId} finished: ${args.outcome}.` }] };
      } catch (error) {
        if (!(error instanceof WorkflowError)) throw error;
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    },
  })] });
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
    const run: WorkflowRun = { id, requestId, session: { id: sessionId, cwd }, startedAt: Date.now(), definition: { name, path: definition.path, text: definition.text, sha256: definition.sha256 }, inputs, state: { kind: "running" }, children: [] };
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
    for (const run of Object.values(doc.records)) if (run.state.kind === "running") await reconcileReportFailures(tx, run);
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
  await reconcileReportFailures(tx, run);
  if (run.children.some((child) => child.state.kind === "working" || (!child.state.delivered && child.state.deliveryError === undefined))) throw new WorkflowError(409, "Wait for associated child work and reports before finishing the workflow");
  await assertChildWorkSettled(tx, parent);
  run.state = { kind: "finished", outcome, result, finishedAt: Date.now() };
  doc.active = null;
}

/** Called in the same commit that allocates a reporter, so association cannot be lost after a crash. */
export async function associateWorkflowChild(tx: Tx, parent: ConversationId, child: ConversationId, reporter: TaskId, name: string): Promise<string | undefined> {
  const doc = await tx.doc(Runs, parent);
  const run = doc.active === null ? undefined : doc.records[doc.active];
  if (run === undefined) return undefined;
  run.children.push({ conversationId: Number(child), reporterId: Number(reporter), name, state: { kind: "working" } });
  return run.id;
}

export async function settleWorkflowChild(tx: Tx, parent: ConversationId, reporter: TaskId, outcome: "answered" | "failed" | "stopped", result: string): Promise<void> {
  const doc = await tx.doc(Runs, parent);
  for (const run of Object.values(doc.records)) {
    const child = run.children.find((item) => item.reporterId === Number(reporter));
    if (child !== undefined) child.state = { kind: "settled", outcome, result, delivered: false };
  }
}
export async function deliveredWorkflowChild(tx: Tx, parent: ConversationId, reporter: TaskId): Promise<void> {
  const doc = await tx.doc(Runs, parent);
  for (const run of Object.values(doc.records)) {
    const child = run.children.find((item) => item.reporterId === Number(reporter));
    if (child?.state.kind === "settled") child.state.delivered = true;
  }
}
export async function activeWorkflowRun(harness: Harness, parent: ConversationId, context: Context): Promise<string | undefined> {
  return (await harness.snapshot(Runs, parent, context))?.active ?? undefined;
}
const reporterIdSchema = Type.Unsafe<TaskId>(Type.Integer({ minimum: 1 }));
async function reconcileReportFailures(tx: Tx, run: WorkflowRun): Promise<void> {
  for (const child of run.children) {
    if (child.state.kind === "settled" && (child.state.delivered || child.state.deliveryError !== undefined)) continue;
    const id = child.reporterId;
    if (!Check(reporterIdSchema, id)) throw new Error("Invalid workflow reporter identity");
    const reporter = await tx.task(id);
    if (reporter?.state.status !== "terminal") continue;
    const reason = `Completion reporter ${reporter.state.outcome.status}; inspect the child transcript.`;
    // A failed reporter must not permanently block explicit completion or pretend it delivered a report.
    child.state = child.state.kind === "settled" ? { ...child.state, deliveryError: reason }
      : { kind: "settled", outcome: "failed", result: reason, delivered: false, deliveryError: reason };
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
