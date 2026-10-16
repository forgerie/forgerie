import { defineDoc, defineExtension, defineTask, defineTool, LiveDoc, type CommitPublication, type Conversation, type ConversationId, type Harness, type Tx } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import { Check } from "typebox/value";
import { DecisionSchema, RecordDecisionSchema, type Decision } from "../../shared/decisions.js";
import { deliverInputUntilPlaced, type InputPlacementState } from "./durableInputPlacement.js";
import { activeWorkflowRunInTx } from "./durableWorkflowRuns.js";
import { WorkflowError } from "../resources/workflowLibrary.js";

export const DECISIONS_DOC_KIND = "forgerie.decisions";
export function decisionsChanged(publication: CommitPublication, parent: ConversationId): boolean {
  return publication.changes.some((change) => change.type === "document" && change.conversationId === parent && change.record.kind === DECISIONS_DOC_KIND);
}
const Decisions = defineDoc<{ records: Record<string, Decision>; recipients: Record<string, ConversationId> }>({
  kind: DECISIONS_DOC_KIND, version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ records: {}, recipients: {} }),
});

/** Call in the action's own commit. A stable action ID is its replay receipt. Other slices use this for gated, auto-stop and issue. */
export async function logDecision(tx: Tx, parent: ConversationId, input: Omit<Decision, "at" | "runId" | "state">, recipient?: ConversationId): Promise<Decision> {
  const doc = await tx.doc(Decisions, parent);
  const existing = Object.hasOwn(doc.records, input.id) ? doc.records[input.id] : undefined;
  if (existing !== undefined) return publicDecision(existing);
  if ([input.question, input.choice, input.reason].some((value) => value.trim() === "")) throw new WorkflowError(400, "A decision needs a question, choice and reason");
  const runId = await activeWorkflowRunInTx(tx, parent);
  const decision: Decision = { ...input, at: Date.now(), ...(runId === undefined ? {} : { runId }), state: { kind: "standing" } };
  if (!Check(DecisionSchema, decision)) throw new WorkflowError(400, "Invalid decision");
  doc.records[input.id] = decision;
  if (recipient !== undefined) doc.recipients[input.id] = recipient;
  return decision;
}
export async function decisions(harness: Harness, parent: ConversationId, context: Context): Promise<Decision[]> {
  return Object.values((await harness.snapshot(Decisions, parent, context))?.records ?? {}).map(publicDecision).sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
}
export async function flaggedDecisions(harness: Harness, parent: ConversationId, context: Context): Promise<number> {
  return (await decisions(harness, parent, context)).filter((decision) => decision.flagged && decision.state.kind === "standing").length;
}
async function correctionRecipient(tx: Tx, parent: ConversationId, id: string): Promise<ConversationId> {
  const child = (await tx.doc(Decisions, parent)).recipients[id];
  return child !== undefined && (await tx.conversation(child)) !== undefined && (await tx.doc(LiveDoc, child)).run !== undefined ? child : parent;
}
const Correction = defineTask<{ id: string; recipient: ConversationId; text: string }, InputPlacementState, null>({
  name: "forgerie.decision-correction", version: 1, initial: () => ({ phase: "deliver" }),
  phases: { deliver: (task, runtime, context) => deliverInputUntilPlaced(runtime, task.state.checkpoint, {
    requestId: `decision-overturn:${task.input.id}`, content: task.input.text, previousRecipient: task.input.recipient,
    selectRecipient: (tx) => correctionRecipient(tx, runtime.conversationId, task.input.id),
  }, context) },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});
/** Confirmation settles review only. It creates no input or task and never resumes the harness. */
export async function confirmDecision(parent: Conversation, id: string, context: Context): Promise<Decision> {
  return parent.commit(async (tx) => {
    const doc = await tx.doc(Decisions, parent.id);
    const decision = Object.hasOwn(doc.records, id) ? doc.records[id] : undefined;
    if (decision === undefined) throw new WorkflowError(404, "Decision not found in this session");
    if (decision.kind !== "guess" || !decision.flagged) throw new WorkflowError(409, "Only flagged guesses can be confirmed");
    if (decision.state.kind === "overturned") throw new WorkflowError(409, "Decision already overturned");
    // Retry receipts keep the first confirmation time, including after reload.
    if (decision.state.kind === "standing") decision.state = { kind: "confirmed", at: Date.now() };
    return publicDecision(decision);
  }, context);
}
export async function overturnDecision(harness: Harness, parent: Conversation, id: string, note: string, context: Context): Promise<Decision> {
  if (note.trim() === "" || note.length > 8000) throw new WorkflowError(400, "A nonblank correction of at most 8000 characters is required");
  const result = await parent.commit(async (tx) => {
    const doc = await tx.doc(Decisions, parent.id);
    const decision = Object.hasOwn(doc.records, id) ? doc.records[id] : undefined;
    if (decision === undefined) throw new WorkflowError(404, "Decision not found in this session");
    if (decision.state.kind === "overturned") throw new WorkflowError(409, "Decision already overturned");
    decision.state = { kind: "overturned", note: note.trim(), at: Date.now() };
    const recipient = await correctionRecipient(tx, parent.id, id);
    await tx.createTask(Correction, { id, recipient, text: `[decision ${id} overturned by the user] Question: ${decision.question} Your choice: ${decision.choice} Correction: ${note.trim()}. Redo the affected work.` }, { ownership: { kind: "conversation" }, background: true });
    return publicDecision(decision);
  }, context);
  harness.resume();
  return result;
}
export function decisionExtension() {
  return defineExtension({ name: "forgerie.decisions", tasks: [Correction], tools: [defineTool({
    name: "record_decision", description: "Record a best guess made in place of a contradicts or stuck escalation, then keep working. Supply question, choice and reason, with guess: true. Do not log ordinary notable choices. Irreversible actions and actions outside the project in the user's name require ask_user instead.",
    parameters: RecordDecisionSchema, replay: "safe", executionMode: "sequential",
    execute: async (args, api, context) => {
      if (!args.guess) return { content: [{ type: "text" as const, text: "record_decision records only guesses in place of an escalation (guess: true), not ordinary choices." }], isError: true };
      try {
        await api.commit((tx) => logDecision(tx, api.conversationId, { id: `d:${String(api.taskId)}`, kind: "guess", by: "parent", question: args.question, choice: args.choice, reason: args.reason, flagged: true }), context);
        return { content: [{ type: "text" as const, text: "Guess recorded. Keep working; the user may overturn it." }] };
      } catch (error) {
        if (!(error instanceof WorkflowError)) throw error;
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    },
  })] });
}
function publicDecision(decision: Decision): Decision {
  const plain: unknown = JSON.parse(JSON.stringify(decision));
  if (!Check(DecisionSchema, plain)) throw new Error("Invalid decision record");
  return plain;
}
