import type { Context } from "@earendil-works/chord";
import { defineDoc, defineExtension, defineTask, type Conversation } from "@earendil-works/pi-durable";
import { processSummarySchema, type ProcessEventSummary } from "../processes/processWatchState.js";
import { deliverInputUntilPlaced, type InputPlacementState } from "./durableInputPlacement.js";
import { Presentation } from "./durableParentDocuments.js";
import { durableJson } from "./durableJson.js";

export const PROCESS_EVENTS_KIND = "forgerie.process-events";
const Receipts = defineDoc<{ lines: Record<string, number> }>({
  kind: "forgerie.process-event-receipts", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ lines: {} }),
});
const Delivery = defineTask<{ id: string; text: string }, InputPlacementState, null>({
  name: "forgerie.process-event-delivery", version: 1, initial: () => ({ phase: "deliver" }),
  phases: { deliver: (task, runtime, context) => deliverInputUntilPlaced(runtime, task.state.checkpoint, {
    requestId: `forgerie.custom-message:process-events:${task.input.id}`, content: task.input.text, previousRecipient: runtime.conversationId,
    selectRecipient: () => Promise.resolve(runtime.conversationId),
    onPlaced: async (tx, entry) => { (await tx.doc(Presentation, runtime.conversationId, String(entry), null)).envelope = { type: "custom", display: false }; },
  }, context) },
  abort: (_task, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});
export function processEventsExtension() { return defineExtension({ name: "forgerie.process-events", tasks: [Delivery] }); }

export function processEventText(value: unknown): string {
  const summary = processSummarySchema.parse(value);
  const heading = `${summary.missed ? "Missed events while Forgerie was down" : "Managed process events"}:`;
  const lines = summary.events.map(event =>
    `${event.name} (${event.processId}), ${event.attention}: ${event.kind === "exit" ? `ended: ${event.reason ?? "ended"}`
      : `${String(event.count)} log match(es), through line ${String(event.line)}${event.samples.slice(0, 3).map(line => `\n  ${String(line.number)}: ${line.text.slice(0, 300)}`).join("")}`}${event.notice === undefined ? "" : ` ${event.notice}`}`);
  const text = [heading, ...lines].join("\n");
  return text.length <= 32_000 ? text : `${text.slice(0, 32_000)}\n[Summary shortened: ${String(summary.events.length)} watch events. Use process list/output for details. Attached processes end when Forgerie restarts.]`;
}

/** Acceptance, deduplication, and the one wake are committed together, before log acknowledgement. */
export async function acceptProcessEvents(conversation: Conversation, summary: ProcessEventSummary, context: Context): Promise<void> {
  await conversation.commit(async tx => {
    const receipts = await tx.doc(Receipts, conversation.id);
    const events = summary.events.filter(event => {
      const key = `${event.processId}:${event.watchId}`;
      const previous = receipts.lines[key];
      if (previous !== undefined && previous >= event.line) return false;
      receipts.lines[key] = event.line;
      return true;
    });
    if (events.length === 0) return;
    const visible = events.filter(event => event.attention !== "ignore");
    const turn = events.some(event => event.attention === "turn");
    const text = processEventText({ ...summary, events: visible });
    await tx.appendEntry(conversation.id, { kind: PROCESS_EVENTS_KIND, data: durableJson({ ...summary, events }),
      ...(visible.length === 0 || turn ? {} : { model: [{ role: "user", content: text, timestamp: Date.now() }] }) });
    if (turn) await tx.createTask(Delivery, { id: summary.id, text }, { ownership: { kind: "conversation" }, conversationId: conversation.id, background: true });
  }, context);
}
