import { defineExtension, defineTask, type Submission, type Tx } from "@earendil-works/pi-durable";
import { ParentAsks } from "./durableParentDocuments.js";
import { renderAskUserAnswersText } from "./sessionAsks.js";

/** This ID is conversation-scoped and stable across crash, retry, and daemon restart. */
export function askAnswerRequestId(askId: string): string { return `forgerie.custom-message:parent-ask:${askId}`; }

const Delivery = defineTask<{ askId: string }, { phase: "deliver"; attempt: number; retryAt?: number; error?: string }, null>({
  name: "forgerie.parent-ask-delivery", version: 1, initial: () => ({ phase: "deliver", attempt: 0 }),
  phases: { deliver: async (task, runtime, context) => {
    if (task.state.checkpoint.retryAt !== undefined) await runtime.sleep(task.state.checkpoint.retryAt, context);
    const receipt = (await runtime.snapshot(ParentAsks, runtime.conversationId, context))?.closed[task.input.askId];
    if (receipt === undefined) throw new Error("Accepted parent answer receipt is missing");
    if (receipt.delivery.kind === "pending") {
      const parent = await runtime.conversation(runtime.conversationId, context);
      if (parent === undefined) throw new Error("Parent answer conversation is missing");
      const requestId = receipt.delivery.requestId;
      let submission: Submission;
      try {
        submission = await parent.submit({ type: "input", content: renderAskUserAnswersText(receipt.outcome), whenBusy: "followUp", requestId }, context);
      } catch (error) {
        runtime.report(error);
        // Keep the decision accepted. Persist the failure and back off; close/crash leaves this checkpoint resumable.
        const attempt = task.state.checkpoint.attempt + 1;
        await runtime.commit(() => ({ status: "running", checkpoint: { phase: "deliver", attempt,
          retryAt: runtime.now() + Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5)), error: error instanceof Error ? error.message : String(error) } }), context);
        return;
      }
      await runtime.commit(async tx => {
        const saved = (await tx.doc(ParentAsks, runtime.conversationId)).closed[task.input.askId];
        if (saved === undefined) throw new Error("Accepted parent answer receipt disappeared");
        saved.delivery = { kind: "admitted", requestId, submissionId: submission.id };
        return { status: "terminal", outcome: { status: "completed", result: null } };
      }, context);
      return;
    }
    await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
  } },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

/** Must be installed before resuming a family. Forks do not clone these conversation-owned tasks. */
export function askDeliveryExtension() { return defineExtension({ name: "forgerie.parent-asks", tasks: [Delivery] }); }
export async function createAskDelivery(tx: Tx, askId: string): Promise<void> {
  await tx.createTask(Delivery, { askId }, { ownership: { kind: "conversation" }, background: true });
}
