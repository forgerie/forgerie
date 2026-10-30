import { AutomatedInputs as Batches, automatedInputSubmission } from "./durableAutomatedInputState.js";
import { mergeAutomatedContent } from "./durableInputContent.js";
import { prepareModelChainInput, stageModelChainInput, batchModelChainInput, SESSION_MODEL_CHAIN_EXTENSION } from "./durableModelChains.js";
import type { Context } from "@earendil-works/chord";
import {
  defineExtension, defineTask, InboxDoc,
  type ConversationHandle, type ConversationId, type Harness, type Submission, type TaskId, type TaskRuntime, type Tx, type UserInput,
} from "@earendil-works/pi-durable";

// All automated sources share this admission line. Keep the version-1 child document/task names so saved outboxes replay.
// Logical receipts survive replay even when several messages share one native input.
/* eslint-disable @typescript-eslint/consistent-type-definitions */
type Delivery = { task: TaskId; requestId: string };
type DeliveryInput = { requestId: string; text: UserInput; whenBusy?: "steer" | "followUp"; previous?: Delivery };
type DeliveryState = { phase: "join" } | { phase: "submit" };
/* eslint-enable @typescript-eslint/consistent-type-definitions */
export const ChildParentDelivery = defineTask<DeliveryInput, DeliveryState, null>({
  name: "forgerie.child-parent-input-delivery", version: 1, initial: () => ({ phase: "join" }),
  phases: {
    join: async (task, runtime, context) => {
      const { previous, requestId, text } = task.input;
      const mode = task.input.whenBusy ?? "followUp";
      // Serialize only admissions, never parent turns or the children's work. A restart resumes this same chain.
      if (previous !== undefined) await runtime.waitForTask(previous.task, context);
      await runtime.commit(async (tx) => {
        const batches = await tx.doc(Batches, runtime.conversationId);
        // A cancelled predecessor can have no receipt. Keep admitted batches independent of the task chain.
        const admitted = mode === "steer" ? batches.steering : batches.admitted;
        const batching = admitted === undefined || runtime.registry.extension(SESSION_MODEL_CHAIN_EXTENSION) === undefined ? "native" : await batchModelChainInput(tx, runtime.conversationId, admitted, text, mode);
        // Sealing and native admission are separate commits. Wait for that handoff rather than splitting the batch.
        if (batching === "sealed") return { status: "running", checkpoint: { phase: "join" } };
        if (batching === "appended" && admitted !== undefined) {
          batches.receipts[requestId] = { task: task.id, requestId: admitted };
          return { status: "terminal", outcome: { status: "completed", result: null } };
        }
        const receipt = admitted === undefined ? undefined : await tx.submissionByRequest(runtime.conversationId, admitted);
        const inbox = await tx.doc(InboxDoc, runtime.conversationId);
        // Automated inputs join the earliest pending automated batch, even across human inputs.
        // Humans retain their own FIFO order and one-at-a-time turns; later automation can pass them.
        const queued = inbox.items.find(item => item.id === receipt?.id);
        if (receipt?.status === "queued" && queued?.mode === mode) {
          // The boundary and this append share the Session mutation line. Once placed, content is never changed.
          queued.content = mergeAutomatedContent(queued.content, text);
          batches.receipts[requestId] = { task: task.id, requestId: receipt.requestId ?? requestId };
          return { status: "terminal", outcome: { status: "completed", result: null } };
        }
        return { status: "running", checkpoint: { phase: "submit" } };
      }, context);
    },
    submit: async (task, runtime, context) => {
      const parent = await runtime.conversation(runtime.conversationId, context);
      if (parent === undefined) throw new Error("Child message parent is missing");
      const whenBusy = task.input.whenBusy ?? "followUp";
      const staged = runtime.registry.extension(SESSION_MODEL_CHAIN_EXTENSION) === undefined ? undefined : await stageModelChainInput(runtime, runtime.conversationId, { content: task.input.text, whenBusy, requestId: task.input.requestId }, context);
      if (staged?.ownsInput !== true) await parent.submit({ type: "input", content: task.input.text, whenBusy, requestId: task.input.requestId }, context);
      await runtime.commit(async (tx) => {
        const batches = await tx.doc(Batches, runtime.conversationId);
        batches.receipts[task.input.requestId] = { task: task.id, requestId: task.input.requestId };
        if (whenBusy === "steer") batches.steering = task.input.requestId;
        else batches.admitted = task.input.requestId;
        return { status: "terminal", outcome: { status: "completed", result: null } };
      }, context);
    },
  },
  abort: (task, runtime, context) => runtime.commit(async (tx) => {
    // Admission can commit just before cancellation, before the submit phase saves its pointer.
    if (await tx.submissionByRequest(runtime.conversationId, task.input.requestId) !== undefined) {
      const batches = await tx.doc(Batches, runtime.conversationId);
      if (task.input.whenBusy === "steer") batches.steering = task.input.requestId;
      else batches.admitted = task.input.requestId;
    }
    return { status: "terminal", outcome: { status: "aborted" } };
  }, context),
});

export const childParentInputExtension = defineExtension({ name: "forgerie.child-parent-input", tasks: [ChildParentDelivery] });

/** The old child receipt reader remains valid for persisted workflow/report records. */
export const childParentSubmission = automatedInputSubmission;

interface AutomatedAdmission extends Pick<Harness, "snapshot" | "watchDoc" | "waitForTask"> {
  readonly taskId?: TaskId;
  readonly conversationId?: ConversationId;
  conversation(id: ConversationId, context: Context): Promise<ConversationHandle | undefined>;
  commit(change: (tx: Tx) => Promise<undefined>, context: Context): Promise<unknown>;
}

/** Admit one logical automated input. Its durable receipt points to the shared native/chain submission. */
export async function submitAutomatedInput(api: AutomatedAdmission, recipient: ConversationId, requestId: string, content: UserInput, context: Context, whenBusy: "steer" | "followUp" = "followUp"): Promise<Submission> {
  let delivery: TaskId | undefined;
  await api.commit(async (tx) => {
    if (await automatedInputSubmission(tx, recipient, requestId) !== undefined) return;
    const batches = await tx.doc(Batches, recipient);
    const existing = batches.receipts[requestId];
    // An aborted admission has no receipt. Recreate it on replay rather than waiting forever on its terminal task.
    if (existing !== undefined) {
      const previous = await tx.task(existing.task);
      if (previous !== undefined && (previous.state.status !== "terminal" || previous.state.outcome.status === "completed")) { delivery = existing.task; return; }
    }
    delivery = await tx.createTask(ChildParentDelivery, { requestId, text: content, whenBusy, ...(batches.tail === undefined ? {} : { previous: batches.tail }) },
      { conversationId: recipient, ...(api.taskId === undefined || api.conversationId !== recipient ? { ownership: { kind: "conversation" as const }, background: true } : { ownership: { kind: "task" as const, taskId: api.taskId } }) });
    batches.tail = { task: delivery, requestId };
    batches.receipts[requestId] = batches.tail;
  }, context);
  if (delivery !== undefined) {
    const settled = await api.waitForTask(delivery, context);
    if (settled.state.outcome.status !== "completed") throw new Error(`Automated input delivery ${String(delivery)} ${settled.state.outcome.status}`);
  }
  let actualRequestId = requestId;
  await api.commit(async (tx) => {
    const receipt = await automatedInputSubmission(tx, recipient, requestId);
    const selected = receipt?.requestId ?? (await tx.doc(Batches, recipient)).receipts[requestId]?.requestId;
    if (selected === undefined) throw new Error("Automated input delivery has no submission receipt");
    actualRequestId = selected;
  }, context);
  const parent = await api.conversation(recipient, context);
  if (parent === undefined) throw new Error("Automated input target is missing");
  // Only the representative chain task may cross the held-intent/native handoff.
  await prepareModelChainInput(api, recipient, { content, whenBusy, requestId: actualRequestId }, context);
  return parent.submit({ type: "input", content, whenBusy, requestId: actualRequestId }, context);
}

export function submitChildParentInput<I, S, R, H extends object>(runtime: TaskRuntime<I, S, R, H>, requestId: string, text: string, context: Context): Promise<Submission> {
  return submitAutomatedInput(runtime, runtime.conversationId, requestId, text, context);
}
