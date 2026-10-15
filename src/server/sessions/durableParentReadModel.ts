import { decisionAnnotations, withRiskAnnotations, withToolInvocationIds } from "../decisions/optionalDecisionAnnotations.js";
import { z } from "zod";
import type { Static } from "typebox";
import { copyJson } from "@earendil-works/chord";
import { Check } from "typebox/value";
import { ChildRunUsageStateSchema } from "../../shared/childRuns.js";
import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import type { ContextView, ConversationView, Cursor, EntryRecord, UsageState, WatchEnd, WatchHandle } from "@earendil-works/pi-durable";
import { AgentDoc, InboxDoc, LiveDoc, UsageDoc } from "@earendil-works/pi-durable";
import { ParentAsks, ParentAsksSchema, ParentResponse, ParentResponseSchema, Presentation, PresentationSchema, SessionName, SessionNameSchema } from "./durableParentDocuments.js";
import { assertHistoryIdentity, SessionOpenError, type SessionOpenPageRequest, type SessionOpenResult } from "./sessionOpen.js";
import { DurableLiveHistory } from "./durableLiveHistory.js";
import { SessionBindings } from "./durableSessionBindings.js";
import type { SessionEventHub } from "../realtime/sessionEventHub.js";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "../../shared/apiTypes.js";
import { ParentAskOutcomeSchema } from "./sessionResponse.js";
import { renderAskUserAnswersText } from "./sessionAsks.js";
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

export interface DurableHostState {
  /** Only state owned by the host. Runtime transcript, ask, queue and compaction state stay native. */
  status?: Pick<Partial<SessionStatus>, "readOnly" | "worktree" | "workingAgents" | "runningProcesses" | "watchingPullRequest" | "waitingOnYou" | "flaggedDecisions" | "warnings" | "pendingDialogs" | "doubleEscapeAction" | "contextUsage">;
  compaction?: { isRunning: boolean; queuedMessages: SessionStatus["queuedMessages"] };
}

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
  private liveHistory: DurableLiveHistory | undefined;
  constructor(private readonly options: DurableParentReadModelOptions) {}

  /** A publisher owns this subscription. Ordinary HTTP readers never retain a history cache. */
  observeHistory(): () => void {
    if (this.liveHistory !== undefined) throw new Error("Native history is already observed");
    const history = new DurableLiveHistory(this.options.handle, (entry, envelope) => this.entryMessages(entry, nativePresentation(entry, envelope), true));
    this.liveHistory = history;
    return () => { history.close(); if (this.liveHistory === history) this.liveHistory = undefined; };
  }

  /**
   * Preload document membership, then use only Tx reads on the serialized line.
   * Membership is guarded by adoption: Tx.doc creates absent documents, which an open must never do.
   */
  async open(cwd: string, request: SessionOpenPageRequest, hub: SessionEventHub, context: Context,
    hostStatus: () => DurableHostState = () => ({})): Promise<SessionOpenResult> {
    const { handle } = this.options;
    const id = handle.conversation.id;
    // Begin observing before preparation; the callback reads the generation on the same cut line.
    hub.nativeHistoryId(handle.address.journalId, handle.harness, id);
    hub.observeNativeRuns(handle.address.sessionId, handle.harness, id);
    let retiredRequired = 0;
    const keys = new Set<string>();
    const membership = new Map<string, number>();
    const stop = handle.harness.subscribeCommits(publication => {
      for (const change of publication.changes) {
        if (change.type === "document" && change.value === null && change.record.kind === SessionBindings.definition.kind) retiredRequired++;
        if (change.type === "document" && change.conversationId === id) {
          if (change.value === null) retiredRequired++;
          if (change.record.kind === Presentation.definition.kind && change.record.key !== undefined) {
            const key = change.record.key;
            membership.set(key, (membership.get(key) ?? 0) + 1);
            if (change.value === null) keys.delete(key); else keys.add(key);
          }
        }
      }
    });
    const unobserve = hub.observeNative(handle.address.sessionId, handle.harness, id);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const membershipRevision = retiredRequired;
        const cached = this.liveHistory?.value;
        const required = cached === undefined ? await Promise.all([
          handle.harness.snapshot(LiveDoc, id, context), handle.harness.snapshot(InboxDoc, id, context),
          handle.harness.snapshot(AgentDoc, id, context), handle.harness.snapshot(UsageDoc, id, context),
          handle.harness.snapshot(ParentAsks, id, context), handle.harness.snapshot(ParentResponse, id, context),
          handle.harness.snapshot(SessionName, id, context),
        ]) : [];
        if (required.some(value => value === undefined)) throw new Error("Native open requires initialized parent documents");
        const bound = cached?.bound ?? (await handle.harness.snapshot(SessionBindings, context)) !== undefined;
        let cursor: Cursor | undefined;
        if (cached === undefined) do {
          const page = await handle.conversation.entries({ order: "ascending" }, SCAN_SIZE, cursor, context);
          for (const entry of page.items) {
            const key = String(entry.id);
            const version = membership.get(key);
            const document = await handle.harness.snapshot(Presentation, id, key, context);
            if (version === membership.get(key)) { if (document === undefined) keys.delete(key); else keys.add(key); }
          }
          cursor = page.next;
        } while (cursor !== undefined);
        const cut = await handle.conversation.commit(async tx => {
          if (membershipRevision !== retiredRequired || cached !== undefined && cached !== this.liveHistory?.value) return undefined;
          const before = hub.currentSeq(handle.address.sessionId);
          const entries: EntryRecord[] = [];
          let cursor: Cursor | undefined;
          if (cached === undefined) do {
            const page = await tx.scanEntries({ conversationId: id, order: "ascending" }, SCAN_SIZE, cursor);
            entries.push(...page.items); cursor = page.next;
          } while (cursor !== undefined);
          // No table reads may follow document acquisition (which can stage initialization).
          if (bound && (await tx.doc(SessionBindings)).sessions[handle.address.sessionId]?.conversationId !== id) {
            throw new SessionOpenError("Session history changed during native open", 409, "HISTORY_CHANGED");
          }
          const live = await tx.doc(LiveDoc, id), inbox = await tx.doc(InboxDoc, id);
          const agent = await tx.doc(AgentDoc, id), usage = await tx.doc(UsageDoc, id);
          const asks = copyJson(await tx.doc(ParentAsks, id)), response = await tx.doc(ParentResponse, id), name = await tx.doc(SessionName, id);
          if (!Check(ParentAsksSchema, asks) || !Check(ParentResponseSchema, response) || !Check(SessionNameSchema, name)) throw new Error("Invalid native parent documents");
          const envelopes = cached?.envelopes ?? new Map<string, Static<typeof PresentationSchema>>();
          for (const key of cached === undefined ? keys : []) {
            const document = await tx.doc(Presentation, id, key, null);
            if (!Check(PresentationSchema, document)) throw new Error("Invalid native presentation document");
            const detached = copyJson(document);
            if (!Check(PresentationSchema, detached)) throw new Error("Invalid detached native presentation");
            envelopes.set(key, detached);
          }
          const messages = cached?.messages ?? entries.flatMap(entry => this.entryMessages(entry, nativePresentation(entry, envelopes.get(String(entry.id))?.envelope), true));
          const seq = hub.currentSeq(handle.address.sessionId);
          const partial = live.generation?.message;
          const tools = (live.tools ?? []).filter(slot => projectBrowserSessionEvent({ type: "tool.start", toolName: slot.name, toolCallId: slot.callId, summary: "" }).type === "tool.start")
            .map(slot => ({ toolCallId: slot.callId, toolName: slot.name, status: slot.status, output: slot.output ?? "" }));
          const host = hostStatus();
          const queuedMessages = [...inbox.items.flatMap(item => item.mode === "write" ? [] : [{ kind: item.mode,
            text: typeof item.content === "string" ? item.content : item.content.flatMap(part => part.type === "text" ? [part.text] : []).join("\n") }]), ...(host.compaction?.queuedMessages ?? [])];
          hub.savedHostOutput(handle.address.sessionId, messages);
          const status: SessionStatus = { ...host.status, sessionId: handle.address.sessionId, persisted: true,
            isStreaming: live.run !== undefined, isCompacting: host.compaction?.isRunning === true || (live.compactions?.length ?? 0) > 0,
            isBashRunning: hub.transientEvents(handle.address.sessionId).reverse().find(event => event.type === "shell.start" || event.type === "shell.end")?.type === "shell.start",
            pendingMessageCount: queuedMessages.length, queuedMessages, messageCount: messages.length, ...durableUsageTotals(usage),
            ...(agent.model === undefined ? {} : { model: { provider: agent.model.provider, id: agent.model.modelId, name: agent.model.modelId } }),
            ...(agent.thinkingLevel === undefined ? {} : { thinkingLevel: agent.thinkingLevel }),
            ...(asks.pending === undefined ? {} : { pendingAsk: asks.pending }),
            response: asks.pending !== undefined ? { kind: "needs-response", reason: "questions" }
              : response.intent === "nothing" ? { kind: "none" } : { kind: "needs-response", reason: response.intent === "questions" ? "reply" : response.intent } };
          if (asks.pending === undefined) delete status.pendingAsk;
          if (before !== hub.currentSeq(handle.address.sessionId)) return undefined;
          if (cached === undefined) this.liveHistory?.seed(entries, envelopes, messages, bound);
          const historyId = hub.nativeHistoryId(handle.address.journalId, handle.harness, id);
          assertHistoryIdentity(historyId, request.historyId);
          return structuredClone({ session: { id: handle.address.sessionId, cwd, ...(name.name === undefined ? {} : { name: name.name }) }, readPath: "native" as const, cut: "native" as const,
            epoch: hub.epoch, seq, historyId, runStartSeq: hub.nativeRunStartSeq(handle.address.sessionId, handle.harness, id, live.run?.inputs[0]),
            page: this.annotate(this.page(messages, { ...request, completeTurns: true })),
            snapshot: { seq, partial: partial === undefined ? null : durableBrowserMessageSchema.parse(projectBrowserMessage(partial)), tools, transientEvents: hub.transientEvents(handle.address.sessionId) }, status, receipt: null });
        }, context);
        if (cut !== undefined) return cut;
      }
      throw new Error("Native open could not acquire a consistent checkpoint after three attempts");
    } finally { stop(); unobserve(); }
  }

  context(context: Context): Promise<ContextView> { return this.options.handle.conversation.context(context); }

  /** Fork-aware complete history, not ConversationView's compacted context range. */
  async messages(context: Context): Promise<DurableBrowserMessage[]> {
    return withRiskAnnotations(this.options.handle.harness, this.options.handle.conversation.id, await this.requiredMessages(context));
  }

  private async requiredMessages(context: Context): Promise<DurableBrowserMessage[]> {
    const messages: DurableBrowserMessage[] = [];
    let cursor: Cursor | undefined;
    do {
      const page = await this.options.handle.conversation.entries({ order: "ascending" }, SCAN_SIZE, cursor, context);
      for (const entry of page.items) {
        const presentation = await this.options.handle.harness.snapshot(Presentation, this.options.handle.conversation.id, String(entry.id), context);
        if (presentation !== undefined && !Check(PresentationSchema, presentation)) throw new Error("Invalid native presentation document");
        messages.push(...this.entryMessages(entry, nativePresentation(entry, presentation?.envelope)));
      }
      cursor = page.next;
    } while (cursor !== undefined);
    return messages;
  }

  async history(page: MessagePageRequest | undefined, context: Context): Promise<DurableBrowserSnapshot["history"]> {
    return this.annotate(this.page(await this.requiredMessages(context), page));
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
    const offLabels = decisionAnnotations(this.options.handle.harness).subscribe((scope, key) => {
      if (scope === String(this.options.handle.conversation.id) && key.startsWith("tool:")) {
        void publish().catch((error: unknown) => finish({ reason: "listener_error", error: error instanceof Error ? error : new Error(String(error)) }));
      }
    });
    let stopping: Promise<void> | undefined;
    const stop = () => {
      stopped = true;
      offLabels();
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
      history: this.annotate(this.page(value.entries.flatMap((entry) => this.entryMessages(entry)))),
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

  private annotate(history: DurableBrowserSnapshot["history"]): DurableBrowserSnapshot["history"] {
    return {...history, messages: withRiskAnnotations(this.options.handle.harness, this.options.handle.conversation.id, history.messages)};
  }

  private page(messages: DurableBrowserMessage[], request?: MessagePageRequest): DurableBrowserSnapshot["history"] {
    const result = pageMessagesAtSafeBoundary(messages, { ...request, limit: request?.limit ?? 100 });
    if (result.messages.length > HISTORY_LIMIT) throw new Error(`Durable history tool round exceeds ${String(HISTORY_LIMIT)} messages; cannot publish an unsafe page boundary`);
    return result;
  }

  private entryMessages(entry: EntryRecord, committed?: readonly unknown[], opening = false): DurableBrowserMessage[] {
    const projected = committed ?? this.options.projectEntry?.(entry) ?? defaultEntryMessages(entry);
    const messages = projected.map((message, index) => {
      const safe = (opening ? openMessageSchema : durableBrowserMessageSchema).parse(projectBrowserMessage(message));
      return { ...safe, id: this.options.messageId(entry, index) };
    });
    // Reuse tool visibility as well as thinking-signature filtering for every read path.
    const visible = projectBrowserMessageResponse({ messages, start: 0, total: messages.length });
    // Preserve the native open schema as well as stable invocation identity.
    return withToolInvocationIds(this.options.handle.conversation.id,
      visible.messages.map((message) => (opening ? openMessageSchema : durableBrowserMessageSchema).parse(message)), entry.id);
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

/** Committed presentation facts, not the SDK view's independently refreshed cache. */
function nativePresentation(entry: EntryRecord, envelope: Static<typeof PresentationSchema>["envelope"]): readonly unknown[] {
  if (envelope === undefined) return defaultEntryMessages(entry);
  const first = entry.model?.[0];
  const data = typeof entry.data === "object" && entry.data !== null && !Array.isArray(entry.data) ? entry.data : {};
  let content = first?.content ?? data["content"];
  if (envelope.type === "custom") {
    if (envelope.display !== true) return [];
    if (content === undefined && envelope.customType === ASK_USER_ANSWERS_CUSTOM_TYPE && Check(ParentAskOutcomeSchema, envelope.details)) content = renderAskUserAnswersText(envelope.details);
    if (content === undefined) throw new Error("Native custom presentation has no content");
    return [{ role: "custom", customType: envelope.customType, content, details: envelope.details, ...(first === undefined ? {} : { timestamp: first.timestamp }) }];
  }
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.flatMap(part => typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string" ? [part.text] : []).join("\n") : "";
  const prefix = `Ran \`${envelope.command ?? ""}\`\n`;
  const start = prefix.length + 4, end = text.lastIndexOf("\n```");
  const output = typeof data["output"] === "string" ? data["output"] : text.startsWith(prefix + "```\n") && end >= start ? text.slice(start, end) : text.startsWith(prefix + "(no output)") ? "" : undefined;
  if (output === undefined) throw new Error("Native shell presentation has no recoverable output");
  return [{ role: "bashExecution", ...envelope, output, ...(first === undefined ? {} : { timestamp: first.timestamp }) }];
}

const openMessageSchema = durableBrowserMessageSchema.extend({ fullOutputPath: z.string().optional() });
