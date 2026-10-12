import { z } from "zod";
import { Check } from "typebox/value";
import { ChildRunUsageStateSchema } from "../../shared/childRuns.js";
import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import type { ContextView, ConversationView, Cursor, EntryRecord, UsageState, WatchEnd, WatchHandle } from "@earendil-works/pi-durable";
import { UsageDoc } from "@earendil-works/pi-durable";
import type { SessionStatus } from "../../shared/apiTypes.js";
import { durableBrowserMessageSchema, durableBrowserSnapshotSchema, type DurableBrowserAppState, type DurableBrowserMessage, type DurableBrowserSnapshot } from "../../shared/durableBrowserSnapshot.js";
import { projectBrowserMessage, projectBrowserMessageResponse, projectBrowserSessionEvent } from "../browserMessageProjection.js";
import { hostEntryText, isHostEntryKind } from "./durableHostEntries.js";
import { pageMessagesAtSafeBoundary, type MessagePageRequest } from "./messagePaging.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";

// Decode only the native mounted fields this projection consumes. Unmounted app documents
// must be supplied by the app-state owner, never read from ConversationView.docs.
const mountedLiveSchema = z.object({
  run: z.unknown().optional(),
  generation: z.object({ message: durableBrowserMessageSchema.optional() }).optional(),
  tools: z.array(z.object({ callId: z.string(), name: z.string(), status: z.enum(["pending", "running", "done"]), output: z.string().optional() })).optional(),
  compactions: z.array(z.unknown()).optional(),
});
const mountedInboxSchema = z.object({ items: z.array(z.object({
  mode: z.enum(["steer", "followUp", "write"]),
  content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }))]).optional(),
})) });

const SCAN_SIZE = 256;
const HISTORY_LIMIT = 500;

export interface DurableParentReadModelOptions {
  handle: DurableSessionHandle;
  /** The native-history owner supplies the shared presentation-ID policy. */
  messageId(entry: EntryRecord, messageIndex: number): string;
  /** Pure projection over committed app documents; undefined uses the built-in message form. */
  projectEntry?(entry: EntryRecord): readonly unknown[] | undefined;
  /** Attach committed app documents explicitly. They are not part of Durable's structural mount. */
  appWatch?(context: Context): Promise<WatchHandle<DurableBrowserAppState>>;
}

export interface DurableBrowserAttachment {
  stop(): Promise<void>;
  readonly closed: Promise<WatchEnd>;
}

/** Committed parent reads. No read, attachment, or replacement resumes the scheduler. */
export class DurableParentReadModel {
  constructor(private readonly options: DurableParentReadModelOptions) {}

  context(context: Context): Promise<ContextView> { return this.options.handle.conversation.context(context); }

  /** Fork-aware complete history, not ConversationView's compacted context range. */
  async messages(context: Context): Promise<DurableBrowserMessage[]> {
    const messages: DurableBrowserMessage[] = [];
    let cursor: Cursor | undefined;
    do {
      const page = await this.options.handle.conversation.entries({ order: "ascending" }, SCAN_SIZE, cursor, context);
      for (const entry of page.items) messages.push(...this.entryMessages(entry));
      cursor = page.next;
    } while (cursor !== undefined);
    return messages;
  }

  async history(page: MessagePageRequest | undefined, context: Context): Promise<DurableBrowserSnapshot["history"]> {
    return this.page(await this.messages(context), page);
  }

  async statistics(context: Context): Promise<{ totalMessages: number; userMessages: number; assistantMessages: number; toolCalls: number; tokens: SessionStatus["tokens"]; cost: number }> {
    let totalMessages = 0, userMessages = 0, assistantMessages = 0, toolCalls = 0;
    let cursor: Cursor | undefined;
    do {
      const page = await this.options.handle.conversation.entries({ order: "ascending" }, SCAN_SIZE, cursor, context);
      for (const entry of page.items) for (const raw of this.options.projectEntry?.(entry) ?? defaultEntryMessages(entry)) {
        const message = durableBrowserMessageSchema.parse(raw);
        totalMessages++;
        if (message.role === "user") userMessages++;
        if (message.role === "assistant") {
          assistantMessages++;
          if (Array.isArray(message.content)) toolCalls += message.content.filter((part) => part.type === "toolCall").length;
        }
      }
      cursor = page.next;
    } while (cursor !== undefined);
    const usage = await this.options.handle.harness.snapshot(UsageDoc, this.options.handle.conversation.id, context);
    return { totalMessages, userMessages, assistantMessages, toolCalls, ...durableUsageTotals(usage ?? { models: {}, tools: {} }) };
  }

  /**
   * Attach before seed; awaiting send exposes a slow transport to Durable's bounded watch.
   * Every frame is a replacement. Neither overflow nor reconnect appends historical messages.
   */
  async attach(
    send: (snapshot: DurableBrowserSnapshot) => Promise<void>,
    onFailure: (error: Error) => void,
    context: Context,
  ): Promise<DurableBrowserAttachment> {
    let watch = await this.options.handle.conversation.watch(context);
    let appWatch: WatchHandle<DurableBrowserAppState> | undefined;
    try { appWatch = await this.options.appWatch?.(context); }
    catch (error) { await watch.stop(); throw error; }
    const epoch = randomUUID();
    let revision = 0;
    let stopped = false;
    let current = watch.value;
    let app = appWatch?.value;
    let line = Promise.resolve();
    // There is at most one awaiting callback per source. Pending frames stay inside Durable's
    // bounded watches; this publisher never creates a transcript-event queue.
    const publish = () => {
      line = line.then(async () => {
        if (!stopped) await send(this.snapshot(current, epoch, revision++, app));
      });
      return line;
    };
    const isStopped = () => stopped;
    let stopping: Promise<void> | undefined;
    const stop = () => {
      stopped = true;
      stopping ??= Promise.all([watch.stop(), appWatch?.stop()]).then(() => undefined);
      return stopping;
    };
    let resolveClosed!: (end: WatchEnd) => void;
    const closed = new Promise<WatchEnd>((resolve) => { resolveClosed = resolve; });
    const finish = async (end: WatchEnd) => {
      if (!stopped) {
        if (end.reason === "listener_error") onFailure(end.error);
        else if (end.reason !== "stopped" && end.reason !== "cancelled") onFailure(new Error(`Durable browser watch ended: ${end.reason}`));
      }
      await stop();
      resolveClosed(end);
    };
    const observe = (observed: typeof watch) => {
      void observed.closed.then(async (end) => { if (observed === watch) await finish(end); });
    };
    observe(watch);
    if (appWatch !== undefined) void appWatch.closed.then(finish);
    const deliver: Parameters<typeof watch.start>[0] = async (value, ops) => {
      if (isStopped()) return;
      if (ops.some((op) => op[0] === "r")) {
        // Overflow can be followed by queued incremental frames. Attach at the latest commit
        // before dropping that backlog, so one replacement covers the whole stalled interval.
        const replacement = await this.options.handle.conversation.watch(context);
        if (isStopped()) { await replacement.stop(); return; }
        const outgoing = watch;
        watch = replacement;
        observe(watch);
        try {
          await outgoing.stop();
          current = watch.value;
          await publish();
          if (!isStopped()) watch.start(deliver);
        } catch (error) {
          // The outgoing watch is already stopped, so it cannot report a new send failure.
          await finish({ reason: "listener_error", error: error instanceof Error ? error : new Error(String(error)) });
        }
      } else {
        current = value;
        await publish();
      }
    };
    try {
      // Both watches are attached before publishing. Changes during the seed remain buffered.
      await publish();
      watch.start(deliver);
      appWatch?.start(async (value) => { app = value; await publish(); });
    } catch (error) { await stop(); throw error; }
    return { closed, stop };
  }

  snapshot(value: ConversationView, epoch: string, revision: number, app?: DurableBrowserAppState): DurableBrowserSnapshot {
    // Built-in mounted documents are owned and validated by pi-durable, not by the browser.
    const live = mountedLiveSchema.parse(value.docs["pi.live"] ?? {});
    const inbox = mountedInboxSchema.parse(value.docs["pi.inbox"] ?? { items: [] });
    const partial = live.generation?.message;
    const queuedMessages = (inbox.items).flatMap((item): DurableBrowserSnapshot["queuedMessages"] => {
      if (item.mode === "write" || item.content === undefined) return [];
      const text = typeof item.content === "string" ? item.content : item.content.flatMap((part) => part.type === "text" && part.text !== undefined ? [part.text] : []).join("\n");
      return [{ kind: item.mode, text }];
    });
    return durableBrowserSnapshotSchema.parse({
      type: "session.snapshot", epoch, revision, ...(app === undefined ? {} : { app }),
      history: this.page(value.entries.flatMap((entry) => this.entryMessages(entry))),
      partial: partial === undefined ? null : durableBrowserMessageSchema.parse(projectBrowserMessage(partial)),
      tools: (live.tools ?? []).filter((slot) => projectBrowserSessionEvent({ type: "tool.start", toolName: slot.name, toolCallId: slot.callId, summary: "" }).type === "tool.start").map((slot) => ({ toolCallId: slot.callId, toolName: slot.name, status: slot.status, output: slot.output ?? "" })),
      queuedMessages, isStreaming: live.run !== undefined, isCompacting: (live.compactions?.length ?? 0) > 0,
    });
  }

  usage(value: ConversationView): Readonly<UsageState> {
    const usage = value.docs["pi.usage"] ?? { models: {}, tools: {} };
    if (!Check(ChildRunUsageStateSchema, usage)) throw new Error("Invalid native parent usage ledger");
    return usage;
  }

  private page(messages: DurableBrowserMessage[], request?: MessagePageRequest): DurableBrowserSnapshot["history"] {
    const result = pageMessagesAtSafeBoundary(messages, { ...request, limit: request?.limit ?? 100 });
    if (result.messages.length > HISTORY_LIMIT) throw new Error(`Durable history tool round exceeds ${String(HISTORY_LIMIT)} messages; cannot publish an unsafe page boundary`);
    return result;
  }

  private entryMessages(entry: EntryRecord): DurableBrowserMessage[] {
    const projected = this.options.projectEntry?.(entry) ?? defaultEntryMessages(entry);
    const messages = projected.map((message, index) => {
      const safe = durableBrowserMessageSchema.parse(projectBrowserMessage(message));
      return { ...safe, id: this.options.messageId(entry, index) };
    });
    // Reuse tool visibility as well as thinking-signature filtering for every read path.
    const visible = projectBrowserMessageResponse({ messages, start: 0, total: messages.length });
    return visible.messages.map((message) => durableBrowserMessageSchema.parse(message));
  }
}

function defaultEntryMessages(entry: EntryRecord): readonly unknown[] {
  if (isHostEntryKind(entry.kind)) return [{ role: "custom", customType: entry.kind, content: hostEntryText(entry.kind, entry.data), display: true, details: entry.data }];
  if (entry.kind === "pi.compaction") return [{ role: "system", source: "compaction", content: `Compacted history:\n\n${modelText(entry)}` }];
  if (entry.kind === "pi.reset") return [];
  if (entry.kind.startsWith("forgerie.") && entry.kind !== "forgerie.legacy-message") return [];
  return (entry.model ?? []).filter((message) => message.role !== "system");
}

function modelText(entry: EntryRecord): string {
  return (entry.model ?? []).flatMap((message) => typeof message.content === "string" ? [message.content]
    : message.content.flatMap((part) => part.type === "text" ? [part.text] : [])).join("\n");
}

/** One aggregation policy for synchronous facade getters and native read-only readers. */
export function durableUsageTotals(usage: Readonly<UsageState>): { tokens: SessionStatus["tokens"]; cost: number } {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let cost = 0;
  for (const value of [...Object.values(usage.models), ...Object.values(usage.tools)]) {
    tokens.input += value.input; tokens.output += value.output; tokens.cacheRead += value.cacheRead; tokens.cacheWrite += value.cacheWrite;
    tokens.total += value.totalTokens; cost += value.cost.total;
  }
  return { tokens, cost };
}
