import type { Context } from "@earendil-works/chord";
import { defineDoc, defineExtension, defineTask, InboxDoc, type Conversation, type ConversationId, type Tx } from "@earendil-works/pi-durable";
import { processSummarySchema, type ProcessEventSummary, type ProcessOverflow } from "../processes/processWatchState.js";
import { deliverInputUntilPlaced, placementRequestId, type InputPlacementState } from "./durableInputPlacement.js";
import { Presentation } from "./durableParentDocuments.js";
import { durableJson } from "./durableJson.js";
import { z } from "zod";

export const PROCESS_EVENTS_KIND = "forgerie.process-events";
const DELIVERY_TASK = "forgerie.process-event-delivery";
const MAX_TEXT = 32_000;
// `texts` holds the current wake text of each live delivery. Coalescing grows it, so a retry after withdrawal keeps every event.
const Receipts = defineDoc<{ lines: Record<string, number>; counts?: Record<string, number>;
  overflow?: { seriesId: string; value: ProcessOverflow; totals?: ProcessOverflow }; texts?: Record<string, string> }>({
  kind: "forgerie.process-event-receipts", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ lines: {} }),
});
const deliveryRequestId = (id: string) => `forgerie.custom-message:process-events:${id}`;
const Delivery = defineTask<{ id: string; text: string }, InputPlacementState, null>({
  name: DELIVERY_TASK, version: 1, initial: () => ({ phase: "deliver" }),
  phases: { deliver: async (task, runtime, context) => {
    const text = (await runtime.snapshot(Receipts, runtime.conversationId, context))?.texts?.[task.input.id] ?? task.input.text;
    await deliverInputUntilPlaced(runtime, task.state.checkpoint, {
      requestId: deliveryRequestId(task.input.id), content: text, previousRecipient: runtime.conversationId,
      selectRecipient: () => Promise.resolve(runtime.conversationId),
      onPlaced: async (tx, entry) => {
        (await tx.doc(Presentation, runtime.conversationId, String(entry), null)).envelope = { type: "custom", display: false };
        await forgetText(tx, runtime.conversationId, task.input.id);
      },
    }, context);
  } },
  abort: (task, runtime, context) => runtime.commit(async tx => {
    await forgetText(tx, runtime.conversationId, task.input.id);
    return { status: "terminal", outcome: { status: "aborted" } };
  }, context),
});

async function forgetText(tx: Tx, conversationId: ConversationId, id: string): Promise<void> {
  const receipts = await tx.doc(Receipts, conversationId);
  if (receipts.texts === undefined || !(id in receipts.texts)) return;
  receipts.texts = Object.fromEntries(Object.entries(receipts.texts).filter(([key]) => key !== id));
}

const liveDelivery = z.object({ input: z.object({ id: z.string() }), state: z.object({ checkpoint: z.object({ attempt: z.number().optional() }) }) });

/**
 * Find a process-event wake that still waits in the inbox. Each queued follow-up costs a model turn, so new events join
 * it instead of queueing another. Uses table reads only; call it before the commit's first table write.
 */
async function queuedDelivery(tx: Tx, conversationId: ConversationId) {
  for (const status of ["running", "pending", "waiting"] as const) {
    for (const task of (await tx.scanTasks({ conversationId, kind: DELIVERY_TASK, status }, 100)).items) {
      const parsed = liveDelivery.safeParse(task);
      if (!parsed.success) continue;
      const { input, state } = parsed.data;
      const submission = await tx.submissionByRequest(conversationId, placementRequestId(deliveryRequestId(input.id), state.checkpoint.attempt));
      if (submission?.status === "queued") return { id: input.id, submission: submission.id };
    }
  }
  return undefined;
}

/** Join two wake texts under one heading when they share it, so the queued item reads as one report. */
export function mergeProcessEventText(queued: string, next: string): string {
  const newline = next.indexOf("\n");
  const heading = newline < 0 ? next : next.slice(0, newline + 1);
  const merged = queued.startsWith(heading) && newline >= 0 ? `${queued}\n${next.slice(newline + 1)}` : `${queued}\n\n${next}`;
  return merged.length <= MAX_TEXT ? merged
    : `${merged.slice(0, MAX_TEXT)}\n[Summary shortened. Use process list/output for details. Attached processes end when Forgerie restarts.]`;
}
export function processEventsExtension() { return defineExtension({ name: "forgerie.process-events", tasks: [Delivery] }); }

export function processEventText(value: unknown): string {
  const summary = processSummarySchema.parse(value);
  const heading = `${summary.missed ? "Missed events while Forgerie was down" : "Managed process events"}:`;
  const lines = summary.events.map(event =>
    `${event.name} (${event.processId}), ${event.attention}: ${event.kind === "exit" ? `ended: ${event.reason ?? `${event.result ?? "ended"}: ${event.code ?? ""} ${event.status ?? ""}`}`
      : `${String(event.count)} log match(es), through line ${String(event.line)}${event.samples.slice(0, 3).map(line => `\n  ${String(line.number)}: ${line.text.slice(0, 300)}`).join("")}`}${event.notice === undefined ? "" : ` ${event.notice}`}`);
  const overflow = summary.overflow;
  const loss = overflow === undefined ? [] : [`[Pending output detail omitted: ${String(overflow.turn + overflow.context + overflow.ignore)} matches from ${String(overflow.aggregates)} aggregate evictions; ${String(overflow.samples)} samples removed.]`];
  const text = [heading, ...loss, ...lines].join("\n");
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT)}\n[Summary shortened: ${String(summary.events.length)} watch events. Use process list/output for details. Attached processes end when Forgerie restarts.]`;
}

/** Consume the daemon outbox: acceptance, line deduplication and the one model wake commit together. */
export async function acceptProcessEvents(conversation: Conversation, summary: ProcessEventSummary, context: Context): Promise<void> {
  await conversation.commit(async tx => {
    const receipts = await tx.doc(Receipts, conversation.id);
    // Table reads must precede the first table write, so look for a queued wake before appending the entry.
    const queued = await queuedDelivery(tx, conversation.id);
    receipts.counts ??= {};
    const counts = receipts.counts;
    const events = summary.events.flatMap(event => {
      const key = `${event.processId}:${event.watchId}`;
      const previous = receipts.lines[key];
      if (previous !== undefined && previous >= event.line) return [];
      const priorCount = counts[key];
      const count = event.totalCount === undefined || priorCount === undefined ? event.count : Math.min(event.count, event.totalCount - priorCount);
      receipts.lines[key] = event.line;
      if (event.totalCount !== undefined) counts[key] = event.totalCount;
      return count <= 0 ? [] : [{ ...event, count, samples: event.samples.filter(sample => sample.number > (previous ?? 0)) }];
    });
    const seriesId = summary.seriesId ?? summary.id;
    const priorOverflow = receipts.overflow?.seriesId === seriesId ? receipts.overflow : undefined;
    const savedOverflow = { turn: 0, context: 0, ignore: 0, samples: 0, aggregates: 0, ...summary.overflow };
    const totals = { ...savedOverflow };
    for (const event of summary.events) if (event.kind === "match") totals[event.attention] += event.count;
    const loss = summary.seriesId === undefined ? overflowDelta(savedOverflow, priorOverflow?.value) : overflowDelta(totals, priorOverflow?.totals);
    if (summary.seriesId !== undefined) {
      // Eviction removes per-watch identity, not the series' exact counts. Subtract accepted
      // retained matches from the series delta, so a crash after acceptance cannot double-count overflow.
      for (const event of events) if (event.kind === "match") loss[event.attention] = Math.max(0, loss[event.attention] - event.count);
    }
    const overflow = Object.values(loss).some(value => value > 0) ? loss : undefined;
    receipts.overflow = { seriesId, value: savedOverflow, totals };
    if (events.length === 0 && (overflow === undefined || !Object.values(overflow).some(value => value > 0))) return;
    const visible = events.filter(event => event.attention !== "ignore");
    const turn = events.some(event => event.attention === "turn") || (overflow?.turn ?? 0) > 0;
    const hasContext = visible.length > 0 || (overflow?.context ?? 0) > 0;
    const text = processEventText({ ...summary, events: visible, overflow: overflow === undefined ? undefined : { ...overflow, ignore: 0 } });
    await tx.appendEntry(conversation.id, { kind: PROCESS_EVENTS_KIND, data: durableJson({ ...summary, events, overflow }),
      ...(!hasContext || turn ? {} : { model: [{ role: "user", content: text, timestamp: Date.now() }] }) });
    if (!turn) return;
    const inbox = await tx.doc(InboxDoc, conversation.id);
    const item = queued === undefined ? undefined : inbox.items.find(candidate => candidate.id === queued.submission);
    if (queued !== undefined && item?.mode === "followUp" && typeof item.content === "string") {
      // The boundary reads this inbox in its own commit, so the merge lands whole before placement or not at all.
      const merged = mergeProcessEventText(item.content, text);
      item.content = merged;
      (receipts.texts ??= {})[queued.id] = merged;
      return;
    }
    (receipts.texts ??= {})[summary.id] = text;
    await tx.createTask(Delivery, { id: summary.id, text }, { ownership: { kind: "conversation" }, conversationId: conversation.id, background: true });
  }, context);
}


function overflowDelta(current: ProcessOverflow, previous: ProcessOverflow | undefined): ProcessOverflow {
  return { turn: Math.max(0, current.turn - (previous?.turn ?? 0)), context: Math.max(0, current.context - (previous?.context ?? 0)),
    ignore: Math.max(0, current.ignore - (previous?.ignore ?? 0)), samples: Math.max(0, current.samples - (previous?.samples ?? 0)),
    aggregates: Math.max(0, current.aggregates - (previous?.aggregates ?? 0)) };
}
