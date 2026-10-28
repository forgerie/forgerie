import { prepareModelChainInput, SESSION_MODEL_CHAIN_EXTENSION } from "./durableModelChains.js";
import type { Context } from "@earendil-works/chord";
import {
  defineDoc, defineExtension, defineTask, InboxDoc,
  type ConversationId, type Submission, type SubmissionRecord, type TaskId, type TaskRuntime, type Tx,
} from "@earendil-works/pi-durable";

// Logical receipts survive replay even when several messages share one native input.
/* eslint-disable @typescript-eslint/consistent-type-definitions */
type Delivery = { task: TaskId; requestId: string };
type BatchState = { tail?: Delivery; admitted?: string; receipts: Record<string, Delivery> };
type DeliveryInput = { requestId: string; text: string; previous?: Delivery };
type DeliveryState = { phase: "join" } | { phase: "submit" };
/* eslint-enable @typescript-eslint/consistent-type-definitions */
const Batches = defineDoc<BatchState>({
  kind: "forgerie.child-parent-input", version: 1, scope: "conversation", history: "latest", fork: "initial",
  initial: () => ({ receipts: {} }),
});

/** Older outboxes have native receipts; new coalesced messages resolve to the shared receipt. */
export async function childParentSubmission(tx: Tx, parent: ConversationId, requestId: string): Promise<SubmissionRecord | undefined> {
  const direct = await tx.submissionByRequest(parent, requestId);
  if (direct !== undefined) return direct;
  const receipt = (await tx.doc(Batches, parent)).receipts[requestId];
  return receipt === undefined ? undefined : tx.submissionByRequest(parent, receipt.requestId);
}

const DeliveryTask = defineTask<DeliveryInput, DeliveryState, null>({
  name: "forgerie.child-parent-input-delivery", version: 1, initial: () => ({ phase: "join" }),
  phases: {
    join: async (task, runtime, context) => {
      const { previous, requestId, text } = task.input;
      // Serialize only admissions, never parent turns or the children's work. A restart resumes this same chain.
      if (previous !== undefined) await runtime.waitForTask(previous.task, context);
      await runtime.commit(async (tx) => {
        const batches = await tx.doc(Batches, runtime.conversationId);
        // A cancelled predecessor can have no receipt. Keep the last admitted batch independent of the task chain.
        const receipt = batches.admitted === undefined ? undefined : await tx.submissionByRequest(runtime.conversationId, batches.admitted);
        const inbox = await tx.doc(InboxDoc, runtime.conversationId);
        // A human input between child messages is an ordering barrier, not part of the child batch.
        const queued = inbox.items.filter(item => item.mode !== "write").at(-1);
        if (receipt?.status === "queued" && queued?.id === receipt.id && queued.mode === "followUp") {
          // The boundary and this append share the Session mutation line. Once placed, content is never changed.
          queued.content = typeof queued.content === "string" ? `${queued.content}\n\n${text}` : [...queued.content, { type: "text", text }];
          batches.receipts[requestId] = { task: task.id, requestId: receipt.requestId ?? requestId };
          return { status: "terminal", outcome: { status: "completed", result: null } };
        }
        return { status: "running", checkpoint: { phase: "submit" } };
      }, context);
    },
    submit: async (task, runtime, context) => {
      const parent = await runtime.conversation(runtime.conversationId, context);
      if (parent === undefined) throw new Error("Child message parent is missing");
      if (runtime.registry.extension(SESSION_MODEL_CHAIN_EXTENSION) !== undefined) await prepareModelChainInput(runtime, runtime.conversationId, { content: task.input.text, whenBusy: "followUp", requestId: task.input.requestId }, context);
      await parent.submit({ type: "input", content: task.input.text, whenBusy: "followUp", requestId: task.input.requestId }, context);
      await runtime.commit(async (tx) => {
        const batches = await tx.doc(Batches, runtime.conversationId);
        batches.receipts[task.input.requestId] = { task: task.id, requestId: task.input.requestId };
        batches.admitted = task.input.requestId;
        return { status: "terminal", outcome: { status: "completed", result: null } };
      }, context);
    },
  },
  abort: (task, runtime, context) => runtime.commit(async (tx) => {
    // Admission can commit just before cancellation, before the submit phase saves its pointer.
    if (await tx.submissionByRequest(runtime.conversationId, task.input.requestId) !== undefined) {
      (await tx.doc(Batches, runtime.conversationId)).admitted = task.input.requestId;
    }
    return { status: "terminal", outcome: { status: "aborted" } };
  }, context),
});

export const childParentInputExtension = defineExtension({ name: "forgerie.child-parent-input", tasks: [DeliveryTask] });

/** Admit one logical message, appending it to the pending child batch when possible. */
export async function submitChildParentInput<I, S, R, H extends object>(runtime: TaskRuntime<I, S, R, H>, requestId: string, text: string, context: Context): Promise<Submission> {
  let delivery: TaskId | undefined;
  await runtime.commit(async (tx) => {
    if (await childParentSubmission(tx, runtime.conversationId, requestId) !== undefined) return;
    const batches = await tx.doc(Batches, runtime.conversationId);
    const existing = batches.receipts[requestId];
    if (existing !== undefined) { delivery = existing.task; return; }
    delivery = await tx.createTask(DeliveryTask, { requestId, text, ...(batches.tail === undefined ? {} : { previous: batches.tail }) },
      { conversationId: runtime.conversationId, ownership: { kind: "task", taskId: runtime.taskId } });
    batches.tail = { task: delivery, requestId };
    batches.receipts[requestId] = batches.tail;
  }, context);
  if (delivery !== undefined) {
    const settled = await runtime.waitForTask(delivery, context);
    if (settled.state.outcome.status !== "completed") throw new Error(`Child message delivery ${String(delivery)} ${settled.state.outcome.status}`);
  }
  let actualRequestId = requestId;
  await runtime.commit(async (tx) => {
    const receipt = await childParentSubmission(tx, runtime.conversationId, requestId);
    if (receipt?.requestId === undefined) throw new Error("Child message delivery has no submission receipt");
    actualRequestId = receipt.requestId;
  }, context);
  const parent = await runtime.conversation(runtime.conversationId, context);
  if (parent === undefined) throw new Error("Child message parent is missing");
  // Re-admission by request ID returns the existing handle without changing or duplicating its content.
  if (runtime.registry.extension(SESSION_MODEL_CHAIN_EXTENSION) !== undefined) await prepareModelChainInput(runtime, runtime.conversationId, { content: text, whenBusy: "followUp", requestId: actualRequestId }, context);
  return parent.submit({ type: "input", content: text, whenBusy: "followUp", requestId: actualRequestId }, context);
}
