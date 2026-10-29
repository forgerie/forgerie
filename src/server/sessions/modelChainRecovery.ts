import { unavailableChildModel } from "./childModelFailures.js";
import { GenerationTask, type ConversationId, type Cursor, type SubmissionId, type SubmissionRecord, type TaskId, type Tx } from "@earendil-works/pi-durable";

// The same native generation can answer multiple admissions. Its retries must have one durable owner.
/* eslint-disable @typescript-eslint/consistent-type-definitions */
export type ModelRecoveryOwner = { owner: TaskId; conversationId: ConversationId; requestId: string };
export type ModelRecoveryLedger = { failureRuns?: Record<string, string>; failureModels?: Record<string, string>; retryOwners?: Record<string, ModelRecoveryOwner> };
/* eslint-enable @typescript-eslint/consistent-type-definitions */

export function claimModelRecovery(doc: ModelRecoveryLedger, run: string, claim: ModelRecoveryOwner): ModelRecoveryOwner {
  const existing = doc.retryOwners?.[run];
  if (existing !== undefined) return existing;
  doc.retryOwners = { ...doc.retryOwners, [run]: claim };
  return claim;
}

export async function recordFailedModelRun(tx: Tx, doc: ModelRecoveryLedger, input: {
  conversationId: ConversationId; generation: TaskId; inputs: readonly SubmissionId[]; model: string;
}): Promise<void> {
  let run = `generation:${String(input.generation)}`;
  for (const [key, claim] of Object.entries(doc.retryOwners ?? {})) {
    if (claim.conversationId !== input.conversationId) continue;
    const retry = await tx.submissionByRequest(input.conversationId, claim.requestId);
    if (retry !== undefined && input.inputs.includes(retry.id)) { run = key; break; }
  }
  doc.failureRuns = { ...doc.failureRuns, ...Object.fromEntries(input.inputs.map(id => [String(id), run])) };
  doc.failureModels = { ...doc.failureModels, ...Object.fromEntries(input.inputs.map(id => [String(id), input.model])) };
}

/** Find this admission's failed generation, not a later input's no_model receipt. IDs share one monotone namespace. */
export async function missingModelRun(tx: Tx, conversationId: ConversationId, input: SubmissionRecord): Promise<{ generation: TaskId; error: string; model: string } | undefined> {
  if (input.type !== "input" || input.entry === undefined) return undefined;
  let cursor: Cursor | undefined;
  let result: { generation: TaskId; error: string; model: string } | undefined;
  do {
    const page = await tx.scanTasks({ conversationId, kind: GenerationTask.definition.name, status: "terminal", order: "descending" }, 100, cursor);
    for (const task of page.items) {
      if (task.id <= input.entry) return result;
      if (task.state.status !== "terminal" || task.state.outcome.status !== "failed") continue;
      const model = unavailableChildModel(task.state.outcome.error.message);
      if (model !== undefined) result = { generation: task.id, error: task.state.outcome.error.message, model };
    }
    cursor = page.next;
  } while (cursor !== undefined);
  return result;
}
