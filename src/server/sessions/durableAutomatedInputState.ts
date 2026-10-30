import { defineDoc, type ConversationId, type SubmissionRecord, type TaskId, type Tx } from "@earendil-works/pi-durable";

// Keep the child batch's version-1 identity: persisted child outboxes and their aliases must replay unchanged.
export const AutomatedInputs = defineDoc<{ tail?: { task: TaskId; requestId: string }; admitted?: string; steering?: string; receipts: Record<string, { task: TaskId; requestId: string }> }>({
  kind: "forgerie.child-parent-input", version: 1, scope: "conversation", history: "latest", fork: "initial",
  initial: () => ({ receipts: {} }),
});

export async function automatedInputRequestId(tx: Tx, recipient: ConversationId, requestId: string): Promise<string> {
  return (await tx.doc(AutomatedInputs, recipient)).receipts[requestId]?.requestId ?? requestId;
}

/** Older outboxes have native receipts; coalesced logical requests resolve to their representative receipt. */
export async function automatedInputSubmission(tx: Tx, recipient: ConversationId, requestId: string): Promise<SubmissionRecord | undefined> {
  const direct = await tx.submissionByRequest(recipient, requestId);
  if (direct !== undefined) return direct;
  const actual = await automatedInputRequestId(tx, recipient, requestId);
  return actual === requestId ? undefined : tx.submissionByRequest(recipient, actual);
}

/** A source-specific card must not hide the other members of a combined native entry. */
export async function isSharedAutomatedInput(tx: Tx, recipient: ConversationId, requestId: string): Promise<boolean> {
  const receipts = (await tx.doc(AutomatedInputs, recipient)).receipts;
  const root = receipts[requestId]?.requestId ?? requestId;
  return Object.entries(receipts).some(([id, receipt]) => id !== root && receipt.requestId === root);
}

/** Admission itself is durable before the representative reaches pi.inbox (for example, during a chain wait). */
export async function hasAutomatedInput(tx: Tx, recipient: ConversationId, requestId: string): Promise<boolean> {
  if (await automatedInputSubmission(tx, recipient, requestId) !== undefined) return true;
  const delivery = (await tx.doc(AutomatedInputs, recipient)).receipts[requestId];
  if (delivery === undefined) return false;
  const task = await tx.task(delivery.task);
  return task !== undefined && (task.state.status !== "terminal" || task.state.outcome.status === "completed");
}
