import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineDoc, InboxDoc, type Conversation, type Cursor, type EntryId, type EntryRecord, type Tx } from "@earendil-works/pi-durable";
import type { SessionTreeSnapshot } from "../../shared/apiTypes.js";
import type { DurableEntryTarget, DurableSessionAddress, DurableSessionHandle } from "./durableSessionAddress.js";
import { bindSession, boundConversationId, readSessionBindings, SessionBindings } from "./durableSessionBindings.js";
import type { InitializeParentDocuments } from "./durableJournalPool.js";
import { projectSessionTree, type ProjectableSessionTreeNode } from "./sessionTreeProjection.js";
import { LegacyTree } from "./durableLegacyImport.js";
import { activeWorkflowRun } from "./durableWorkflowRuns.js";
import { openChildQuestions } from "./durableChildAgents.js";

export interface DurableNativeHistory {
  tree(context: Context): Promise<SessionTreeSnapshot>;
  resolve(entryId: string, context: Context): Promise<DurableEntryTarget>;
  fork(entryId: string, position: "before" | "at", newSessionId: string, context: Context): Promise<{ handle: DurableSessionHandle; selectedText?: string }>;
  select(entryId: string, options: { summarize?: boolean; customInstructions?: string }, context: Context): Promise<{ handle: DurableSessionHandle; cancelled: boolean; editorText?: string }>;
}
interface HistoryOptions {
  acquire(address: DurableSessionAddress, context: Context): Promise<DurableSessionHandle>;
  initializeParentDocuments?: InitializeParentDocuments;
  /** Host summary hook preserves extension hooks and cancellation; it must not compact the source. */
  summarize?: (source: Conversation, cut: EntryId, instructions: string | undefined, context: Context) => Promise<{ cancelled: boolean; summary?: string }>;
  validateCandidate?: (handle: DurableSessionHandle, context: Context) => Promise<void>;
  /** Publish only after commit. Bindings remain the authority if publication fails. */
  publishCatalog?: (address: DurableSessionAddress, context: Context) => Promise<void>;
}
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type EntryAliasState = { aliases: Record<string, { conversationId: number; entryId: number; messageIndex: number }> };
export const NativeEntryAliases = defineDoc({ kind: "forgerie.entry-aliases", version: 1, scope: "session", initial: (): EntryAliasState => ({ aliases: {} }) });
interface Target { entry: EntryRecord; index: number; source: Conversation; predecessor: EntryRecord | undefined }

export function durableEntryPresentationId(journalId: string, entry: Pick<EntryRecord, "id" | "conversationId"> & Partial<Pick<EntryRecord, "data">>, messageIndex: number): string {
  if (messageIndex === 0 && typeof entry.data === "object" && entry.data !== null && !Array.isArray(entry.data) && typeof entry.data["sdkEntryId"] === "string") return entry.data["sdkEntryId"];
  return `durable:${encodeURIComponent(journalId)}:${String(entry.conversationId)}:${String(entry.id)}:${String(messageIndex)}`;
}

export function createDurableNativeHistory(handle: DurableSessionHandle, options: HistoryOptions): DurableNativeHistory {
  return new NativeHistory(handle, options);
}

class NativeHistory implements DurableNativeHistory {
  constructor(private readonly handle: DurableSessionHandle, private readonly options: HistoryOptions) {}

  private async targets(context: Context, retained: boolean): Promise<Map<string, Target[]>> {
    const state = await readSessionBindings(this.handle.harness, context);
    const binding = state.sessions[this.handle.address.sessionId];
    if (binding === undefined) throw new Error("Unknown logical session");
    const ids = retained ? binding.retained.map(boundConversationId) : [this.handle.conversation.id];
    const targets = new Map<string, Target[]>();
    const imported = await this.handle.harness.snapshot(LegacyTree, context);
    const nativeAliases = await this.handle.harness.snapshot(NativeEntryAliases, context);
    const aliasesByEntry = new Map<string, string[]>();
    for (const [alias, mapped] of [...Object.entries(imported?.aliases ?? {}), ...Object.entries(nativeAliases?.aliases ?? {})]) {
      const key = `${String(mapped.conversationId)}:${String(mapped.entryId)}:${String(mapped.messageIndex)}`;
      const aliases = aliasesByEntry.get(key) ?? [];
      aliases.push(alias);
      aliasesByEntry.set(key, aliases);
    }
    for (const id of ids) {
      const conversation = await this.handle.harness.conversation(id, context);
      if (conversation === undefined) throw new Error("Missing retained conversation");
      let predecessor: EntryRecord | undefined;
      for (const entry of await allEntries(conversation, context)) {
        const count = Math.max(1, entry.model?.length ?? 0);
        for (let index = 0; index < count; index++) {
          const target = { entry, index, source: conversation, predecessor };
          addTarget(targets, durableEntryPresentationId(state.journalId, entry, index), target);
          const sdk = index === 0 ? sdkAlias(entry) : undefined;
          if (sdk !== undefined) addTarget(targets, sdk, target);
          const key = `${String(entry.conversationId)}:${String(entry.id)}:${String(index)}`;
          for (const alias of aliasesByEntry.get(key) ?? []) addTarget(targets, alias, target);
        }
        predecessor = entry;
      }
    }
    return targets;
  }
  private async target(id: string, context: Context, retained = false): Promise<Target> {
    const matches = (await this.targets(context, retained)).get(id) ?? [];
    const target = matches[0];
    if (matches.length !== 1 || target === undefined) throw new Error("Unknown, foreign, ambiguous, or invisible entry ID");
    return target;
  }
  async resolve(entryId: string, context: Context): Promise<DurableEntryTarget> {
    const { entry, index } = await this.target(entryId, context);
    return { journalId: this.handle.address.journalId, conversationId: entry.conversationId, entryId: entry.id, messageIndex: index };
  }
  async tree(context: Context): Promise<SessionTreeSnapshot> {
    const targets = await this.targets(context, true);
    const unique = new Map<string, Target>();
    for (const matches of targets.values()) for (const target of matches) {
      unique.set(durableEntryPresentationId(this.handle.address.journalId, target.entry, target.index), target);
    }
    const imported = await this.handle.harness.snapshot(LegacyTree, context);
    const importedEntries = new Map(imported?.entries.flatMap((entry) => isRecord(entry) && typeof entry["id"] === "string" ? [[entry["id"], entry]] : []) ?? []);
    const roots: ProjectableSessionTreeNode[] = [];
    const nodes = new Map<string, { entry: unknown; children: ProjectableSessionTreeNode[] }>();
    const presentationId = (entry: EntryRecord, index: number) => index === 0 ? sdkAlias(entry) ?? durableEntryPresentationId(this.handle.address.journalId, entry, index) : durableEntryPresentationId(this.handle.address.journalId, entry, index);
    const sorted = [...unique.values()].sort((left, right) => left.entry.id - right.entry.id || left.index - right.index);
    for (const { entry, index, predecessor } of sorted) {
      const parentId = index > 0 ? presentationId(entry, index - 1) : predecessor === undefined ? null : presentationId(predecessor, Math.max(0, (predecessor.model?.length ?? 1) - 1));
      const sdk = index === 0 ? importedEntries.get(presentationId(entry, index)) : undefined;
      const shape = sdk ?? { type: entry.kind === "pi.compaction" ? "compaction" : entry.kind === "forgerie.branch-summary" ? "branch_summary" : entry.model?.[index] === undefined ? "custom" : "message",
        message: entry.model?.[index], customType: entry.kind, summary: typeof entry.data === "string" ? entry.data : undefined };
      const node = { entry: { ...shape, id: presentationId(entry, index), parentId }, children: [] };
      nodes.set(presentationId(entry, index), node);
      if (parentId === null) roots.push(node);
      else {
        const parent = nodes.get(parentId);
        if (parent === undefined) throw new Error("Native tree has a missing parent");
        parent.children.push(node);
      }
    }
    const activeEntries = await allEntries(this.handle.conversation, context);
    const leaf = activeEntries.at(-1);
    return projectSessionTree(roots, leaf === undefined ? null : presentationId(leaf, Math.max(0, (leaf.model?.length ?? 1) - 1)));
  }
  async fork(entryId: string, position: "before" | "at", newSessionId: string, context: Context) {
    const target = await this.target(entryId, context);
    const { cut, text } = this.cut(target, position);
    await this.assertAdmission(context);
    const conversation = await target.source.fork(cut.id, { ownership: { kind: "ownerless" }, init: async (tx, id) => {
      await this.options.initializeParentDocuments?.(tx, { id, parent: { conversationId: target.source.id, at: cut.id } });
      await bindSession(tx, this.handle.address.journalId, newSessionId, id, this.handle.address.sessionId);
    } }, context);
    const address = { ...this.handle.address, sessionId: newSessionId, conversationId: conversation.id };
    const candidate = await this.options.acquire(address, context);
    try { await this.options.validateCandidate?.(candidate, context); await this.options.publishCatalog?.(address, context); }
    catch (error) { await candidate.release(BACKGROUND_CONTEXT); throw error; }
    return { handle: candidate, ...(text === undefined ? {} : { selectedText: text }) };
  }
  async select(entryId: string, options: { summarize?: boolean; customInstructions?: string }, context: Context) {
    const target = await this.target(entryId, context, true);
    const isUser = target.entry.model?.[target.index]?.role === "user";
    const { cut, text } = this.cut(target, isUser ? "before" : "at");
    await this.assertAdmission(context);
    let summary: string | undefined;
    if (options.summarize === true) {
      if (this.options.summarize === undefined) throw new Error("Native branch summarization is unavailable");
      const result = await this.options.summarize(this.handle.conversation, cut.id, options.customInstructions, context);
      if (result.cancelled) return { handle: this.handle, cancelled: true };
      if (result.summary === undefined) throw new Error("Branch summary did not provide a summary");
      summary = result.summary;
    }
    const bindings = await readSessionBindings(this.handle.harness, context);
    const binding = bindings.sessions[this.handle.address.sessionId];
    if (binding === undefined) throw new Error("Missing logical binding");
    let continuation: Conversation | undefined;
    if (summary === undefined) {
      for (const id of binding.retained) {
        const retained = await this.handle.harness.conversation(boundConversationId(id), context);
        if (retained !== undefined && (await allEntries(retained, context)).at(-1)?.id === cut.id) { continuation = retained; break; }
      }
    }
    continuation ??= await target.source.fork(cut.id, { ownership: { kind: "ownerless" }, init: async (tx, id) => {
      await this.options.initializeParentDocuments?.(tx, { id, parent: { conversationId: target.source.id, at: cut.id } });
      const state = await tx.doc(SessionBindings);
      const current = state.sessions[this.handle.address.sessionId];
      if (current === undefined) throw new Error("Missing logical binding");
      current.retained.push(id);
      if (summary !== undefined) await tx.appendEntry(id, { kind: "forgerie.branch-summary", data: summary,
        model: [{ role: "user", content: summary, timestamp: Date.now() }] });
    } }, context);
    const address = { ...this.handle.address, conversationId: continuation.id };
    const candidate = await this.options.acquire(address, context);
    try {
      await this.options.validateCandidate?.(candidate, context);
      await this.handle.harness.commit(async (tx) => {
        await assertIdle(tx, this.handle.conversation.id);
        const current = (await tx.doc(SessionBindings)).sessions[this.handle.address.sessionId];
        if (current?.conversationId !== this.handle.conversation.id) throw new Error("Stale logical session selection");
        current.conversationId = candidate.conversation.id;
      }, context);
      await this.options.publishCatalog?.(address, context);
    } catch (error) { await candidate.release(BACKGROUND_CONTEXT); throw error; }
    return { handle: candidate, cancelled: false, ...(text === undefined ? {} : { editorText: text }) };
  }
  private cut(target: Target, position: "before" | "at"): { cut: EntryRecord; text?: string } {
    if (position === "at") {
      if (target.index < (target.entry.model?.length ?? 1) - 1) throw new Error("Unsupported mid-entry cut; select the containing entry boundary");
      return { cut: target.entry };
    }
    const message = target.entry.model?.[target.index];
    if (message?.role !== "user") throw new Error("Only a user message can be forked before its entry");
    if (target.index !== 0) throw new Error("Unsupported mid-entry cut; select the containing entry boundary");
    const preceding = target.predecessor;
    if (preceding === undefined) throw new Error("Missing model-empty origin anchor");
    const text = typeof message.content === "string" ? message.content : message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    return { cut: preceding, text };
  }
  private async assertAdmission(context: Context): Promise<void> {
    if (await activeWorkflowRun(this.handle.harness, this.handle.conversation.id, context) !== undefined || await openChildQuestions(this.handle.harness, this.handle.conversation.id, context) > 0) {
      throw new Error("Cannot navigate or fork while child questions or a workflow remain active");
    }
    await this.handle.harness.commit(async (tx) => {
      await assertIdle(tx, this.handle.conversation.id);
      if ((await tx.doc(SessionBindings)).sessions[this.handle.address.sessionId]?.conversationId !== this.handle.conversation.id) throw new Error("Stale logical session selection");
    }, context);
  }
}

async function assertIdle(tx: Tx, conversationId: Conversation["id"]): Promise<void> {
  const relevant = new Set([conversationId]);
  let cursor: Cursor | undefined;
  const records = [];
  do { const page = await tx.scanConversations({}, 256, cursor); records.push(...page.items); cursor = page.next; } while (cursor !== undefined);
  let grew: boolean;
  do {
    grew = false;
    for (const record of records) if (record.owner !== undefined && relevant.has(record.owner.conversationId) && !relevant.has(record.id)) { relevant.add(record.id); grew = true; }
  } while (grew);
  cursor = undefined;
  do {
    const page = await tx.scanTasks({}, 256, cursor);
    if (page.items.some((task) => relevant.has(task.conversationId) && task.state.status !== "terminal")) throw new Error("Cannot navigate or fork while parent, child, or workflow work is active");
    cursor = page.next;
  } while (cursor !== undefined);
  for (const id of relevant) {
    const inbox = await tx.doc(InboxDoc, id);
    if (inbox.items.length > 0) throw new Error("Cannot navigate or fork with queued work");
  }
}
async function allEntries(conversation: Conversation, context: Context): Promise<EntryRecord[]> {
  const entries: EntryRecord[] = [];
  let cursor: Cursor | undefined;
  do { const page = await conversation.entries({ order: "ascending" }, 256, cursor, context); entries.push(...page.items); cursor = page.next; } while (cursor !== undefined);
  return entries;
}
function addTarget(map: Map<string, Target[]>, id: string, target: Target): void {
  const previous = map.get(id) ?? [];
  if (!previous.some((value) => value.entry.id === target.entry.id && value.index === target.index)) previous.push(target);
  map.set(id, previous);
}
function sdkAlias(entry: EntryRecord): string | undefined {
  return isRecord(entry.data) && typeof entry.data["sdkEntryId"] === "string" ? entry.data["sdkEntryId"] : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
