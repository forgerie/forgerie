import { copyJson } from "@earendil-works/chord";
import { awaitWithContext, withAbortSignal } from "@earendil-works/chord/context";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { defineExtension, defineTask, InboxDoc, type ConversationId, type Submission, type Tx } from "@earendil-works/pi-durable";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "../../shared/apiTypes.js";
import { ParentAsks, Presentation } from "./durableParentDocuments.js";
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
      const [message] = convertToLlm([{ role: "custom", customType: ASK_USER_ANSWERS_CUSTOM_TYPE,
        content: renderAskUserAnswersText(receipt.outcome), display: true, details: receipt.outcome, timestamp: runtime.now() }]);
      if (message?.role !== "user") throw new Error("Parent answer must convert to a custom-message model input");
      let submission: Submission;
      try {
        submission = await parent.submit({ type: "input", content: message.content, whenBusy: "followUp", requestId }, context);
      } catch (error) {
        runtime.report(error);
        // Keep the decision accepted. Persist the failure and back off; close/crash leaves this checkpoint resumable.
        const attempt = task.state.checkpoint.attempt + 1;
        await runtime.commit(() => ({ status: "running", checkpoint: { phase: "deliver", attempt,
          retryAt: runtime.now() + Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5)), error: error instanceof Error ? error.message : String(error) } }), context);
        return;
      }
      let placed = await submission.status(context);
      if (placed.status === "queued") {
        // A follow-up has no entry until its inbox boundary. Watch placement, not the eventual model answer.
        // Attach before checking the seed so a boundary between status() and attachment cannot be missed.
        const inbox = await runtime.watchDoc(InboxDoc, runtime.conversationId, context);
        if (inbox === undefined) throw new Error("Parent answer inbox is missing");
        let leaveInbox!: () => void;
        const leftInbox = new Promise<void>(resolve => { leaveInbox = resolve; });
        const observe = (value: typeof inbox.value) => {
          if (value?.items.some(item => item.id === submission.id) !== true) leaveInbox();
        };
        try {
          observe(inbox.value);
          inbox.start(value => { observe(value); return Promise.resolve(); });
          await awaitWithContext(leftInbox, withAbortSignal(runtime.signal, context));
        } finally { await inbox.stop(); }
        placed = await submission.status(context);
        if (placed.status === "queued") throw new Error("Parent answer left its inbox without placement or withdrawal");
      }
      const entryId = placed.entry;
      await runtime.commit(async tx => {
        const saved = (await tx.doc(ParentAsks, runtime.conversationId)).closed[task.input.askId];
        if (saved === undefined) throw new Error("Accepted parent answer receipt disappeared");
        // The browser and SDK derive one custom card from the actual admitted entry, never the close marker.
        if (entryId !== undefined) (await tx.doc(Presentation, runtime.conversationId, String(entryId), null)).envelope = {
          type: "custom", customType: ASK_USER_ANSWERS_CUSTOM_TYPE, display: true, details: copyJson(receipt.outcome),
        };
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
export async function createAskDelivery(tx: Tx, conversationId: ConversationId, askId: string): Promise<void> {
  await tx.createTask(Delivery, { askId }, { ownership: { kind: "conversation" }, conversationId, background: true });
}
