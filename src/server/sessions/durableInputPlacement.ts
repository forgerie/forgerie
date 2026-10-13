import type { Context } from "@earendil-works/chord";
import type { ConversationId, TaskRuntime, Tx } from "@earendil-works/pi-durable";

// Optional fields keep version-1 outboxes replayable with their original receipt. Checkpoints need a JSON-compatible alias.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type InputPlacementState = { phase: "deliver"; attempt?: number; recipient?: ConversationId };
interface InputPlacementOptions {
  requestId: string;
  content: string;
  previousRecipient: ConversationId;
  selectRecipient(tx: Tx): Promise<ConversationId>;
}

/** A queued receipt is not delivery. Keep the outbox live until an entry exists, retrying only unplaced withdrawals. */
export async function deliverInputUntilPlaced<I>(runtime: TaskRuntime<I, InputPlacementState, null, object>, state: InputPlacementState,
  options: InputPlacementOptions, context: Context): Promise<void> {
  const attempt = state.attempt ?? 0;
  const requestId = attempt === 0 ? options.requestId : `${options.requestId}:retry:${String(attempt)}`;
  const recipient = state.recipient;
  if (recipient === undefined) {
    await runtime.commit(async (tx) => {
      // A crash can happen after submit but before the old outbox's terminal commit. Preserve that receipt's target.
      const previous = attempt === 0 ? await tx.submissionByRequest(options.previousRecipient, requestId) : undefined;
      const selected = previous === undefined ? await options.selectRecipient(tx) : options.previousRecipient;
      return { status: "running", checkpoint: { phase: "deliver", attempt, recipient: selected } };
    }, context);
    return;
  }
  const progress = { rerouted: false };
  await runtime.commit(async (tx) => {
    if (await tx.submissionByRequest(recipient, requestId) !== undefined) return undefined;
    const selected = await options.selectRecipient(tx);
    if (selected === recipient) return undefined;
    // Selection can precede a crash. Until admission, a correction must still follow the current live target.
    progress.rerouted = true;
    return { status: "running", checkpoint: { phase: "deliver", attempt, recipient: selected } };
  }, context);
  if (progress.rerouted) return;
  const conversation = await runtime.conversation(recipient, context);
  if (conversation === undefined) throw new Error("Input delivery target is missing");
  const submission = await conversation.submit({ type: "input", content: options.content, whenBusy: "followUp", requestId }, context);
  for (;;) {
    const receipt = await submission.status(context);
    // Even unanswered inputs were delivered if they have an entry (for example, a run aborted after placement).
    if (receipt.entry !== undefined) {
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
      return;
    }
    if (receipt.status === "unanswered") {
      // A new checkpoint reserves a fresh receipt and reselects the target. Reopen reuses it, never the withdrawn ID.
      await runtime.commit(() => ({ status: "running", checkpoint: { phase: "deliver", attempt: attempt + 1 } }), context);
      return;
    }
    await runtime.sleep(runtime.now() + 250, context);
  }
}
