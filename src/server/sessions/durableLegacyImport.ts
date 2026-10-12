import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Context, JsonValue } from "@earendil-works/chord";
import { buildSessionProjection, convertToLlm, sessionEntryToContextMessages, type SessionEntry, type SessionManager } from "@earendil-works/pi-coding-agent";
import { configure, defineDoc, type Conversation, type Cursor, type EntryId, type EntryRecord, type ContextEdit } from "@earendil-works/pi-durable";
import type { DurableSessionHandle } from "./durableSessionAddress.js";
import type { DurableJournalPool, InitializeParentDocuments } from "./durableJournalPool.js";
import { bindSession, readSessionBindings, SessionBindings } from "./durableSessionBindings.js";
import { durableJson } from "./durableJson.js";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

// Structural aliases keep document values assignable to strict JsonValue.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ImportedTarget = { conversationId: number; entryId: number; messageIndex: number }
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type LegacyTreeState = { entries: JsonValue[]; aliases: Record<string, ImportedTarget> }
export const LegacyTree = defineDoc({ kind: "forgerie.legacy-tree", version: 1, scope: "session", initial: (): LegacyTreeState => ({ entries: [], aliases: {} }) });
// Keep the base build's receipt readable. Graph progress has its own document;
// it does not change what forgerie.import.complete means to the base adapter.
const OriginalImport = defineDoc({ kind: "forgerie.import", version: 1, scope: "session", initial: (): { complete: boolean } => ({ complete: false }) });
const ImportReceiptSchema = Type.Object({
  sourceHash: Type.String(), count: Type.Integer({ minimum: 0 }), complete: Type.Boolean(), legacyProjectionComplete: Type.Boolean(),
  originConversationId: Type.Optional(Type.Integer({ minimum: 0 })), originEntryId: Type.Optional(Type.Integer({ minimum: 0 })),
  keepOriginalSelection: Type.Optional(Type.Boolean()), failure: Type.Optional(Type.String()),
}, { additionalProperties: false });
type ImportReceipt = Static<typeof ImportReceiptSchema>;
const initialReceipt = (): ImportReceipt => ({ sourceHash: "", count: 0, complete: false, legacyProjectionComplete: false });
export const LegacyMigration = defineDoc({ kind: "forgerie.legacy-import", version: 1, scope: "session", initial: initialReceipt });
const PreviousGraphReceipt = defineDoc({ kind: "forgerie.import", version: 2, scope: "session", initial: initialReceipt });

/** Repair journals opened by the core build without discarding its verified graph receipt. */
export async function prepareLegacyImportReceipt(handle: DurableSessionHandle, pool: DurableJournalPool, context: Context): Promise<void> {
  const found = await pool.inspectStorage(handle.address.databasePath, async (storage) => {
    const record = await storage.findDocument({ kind: "forgerie.import", scope: { kind: "session" } }, "current", context);
    return record === undefined ? undefined : storage.document(record.id, "current", context);
  }, context);
  if (!found.found) throw new Error("Import receipt has no leased journal owner");
  const previous = found.value;
  if (previous === undefined || previous.version === 1) return;
  if (previous.version !== 2 || !Check(ImportReceiptSchema, previous.value)) throw new Error("Unsupported original import receipt");
  const saved = previous.value;
  await handle.harness.commit(async (tx) => {
    const progress = await tx.doc(LegacyMigration);
    if (progress.sourceHash !== "" && progress.sourceHash !== saved.sourceHash) throw new Error("Conflicting graph import receipts");
    Object.assign(progress, saved);
    await tx.retireDoc(PreviousGraphReceipt);
    (await tx.doc(OriginalImport)).complete = saved.legacyProjectionComplete || saved.complete;
  }, context);
}

/** A rejected legacy source is not a damaged native storage or ownership failure. */
export class LegacyImportError extends Error {
  override readonly name = "LegacyImportError";
}

/** Whole graph import. Passive commits never submit input, start tasks, or run a provider. */
export async function importDurableLegacyTree(handle: DurableSessionHandle, manager: SessionManager, context: Context, initializeParentDocuments?: InitializeParentDocuments): Promise<void> {
  const entries = legacyEntries(manager.getEntries(), manager.getSessionId());
  const sourceHash = createHash("sha256").update(JSON.stringify(durableJson(entries))).digest("hex");
  const receipt = await handle.harness.snapshot(LegacyMigration, context);
  const originalComplete = (await handle.harness.snapshot(OriginalImport, context))?.complete === true;
  if (receipt?.complete === true) {
    if (receipt.sourceHash !== sourceHash) throw new LegacyImportError("Legacy source changed after verified import; stop cutover and reconcile metadata");
    return;
  }
  if (receipt !== undefined && receipt.sourceHash !== "" && receipt.sourceHash !== sourceHash) throw new LegacyImportError("Legacy import source conflicts with saved progress");
  const ordered = topological(entries);
  const bindings = await readSessionBindings(handle.harness, context);
  const existingEntries = await scanEntries(handle.conversation, context);
  let originConversation = handle.conversation;
  let origin = existingEntries.find((entry) => entry.kind === "forgerie.origin");
  const hadNativeHistory = receipt?.keepOriginalSelection ?? existingEntries.some((entry) => entry.kind !== "forgerie.origin");
  if (receipt?.originConversationId !== undefined && receipt.originEntryId !== undefined) {
    const savedOrigin = await handle.harness.conversation(nativeConversationId(receipt.originConversationId), context);
    if (savedOrigin === undefined) throw new Error("Missing checkpointed import origin");
    originConversation = savedOrigin;
    origin = (await scanEntries(savedOrigin, context)).find((entry) => entry.id === receipt.originEntryId);
    if (origin?.kind !== "forgerie.origin") throw new Error("Invalid checkpointed import origin");
  } else if (origin === undefined || hadNativeHistory) {
    // Preserve the old selected conversation, children, workflows, tasks, and immutable entries.
    originConversation = await handle.harness.createConversation({ ownership: { kind: "ownerless" }, agent: { cwd: manager.getCwd() }, init: async (tx, id) => {
      await initializeParentDocuments?.(tx, { id });
      await tx.appendEntry(id, { kind: "forgerie.origin" });
      const binding = (await tx.doc(SessionBindings)).sessions[handle.address.sessionId];
      if (binding === undefined) throw new Error("Missing logical import binding");
      binding.retained.push(id);
    } }, context);
    origin = (await scanEntries(originConversation, context))[0];
  }
  if (origin === undefined) throw new Error("Import has no empty origin");
  await handle.harness.commit(async (tx) => {
    const progress = await tx.doc(LegacyMigration);
    progress.sourceHash = sourceHash;
    progress.legacyProjectionComplete = progress.legacyProjectionComplete || originalComplete;
    progress.originConversationId = originConversation.id;
    progress.originEntryId = origin.id;
    progress.keepOriginalSelection = hadNativeHistory;
    (await tx.doc(LegacyTree)).entries = entries.map(durableJson);
  }, context);
  const imported = new Map<string, { conversation: Conversation; entry: EntryRecord }>();
  const tips = new Map<number, EntryId>([[originConversation.id, origin.id]]);
  const saved = await handle.harness.snapshot(LegacyTree, context);
  for (const source of ordered) {
    const prior = source.parentId === null ? { conversation: originConversation, entry: origin } : imported.get(source.parentId);
    if (prior === undefined) throw new Error("Legacy import has a missing parent");
    let conversation = prior.conversation;
    const checkpoint = saved?.aliases[source.id];
    if (checkpoint !== undefined) {
      const previous = await handle.harness.conversation(nativeConversationId(checkpoint.conversationId), context);
      const native = previous === undefined ? undefined : (await scanEntries(previous, context)).find((entry) => entry.id === checkpoint.entryId);
      if (previous === undefined || native === undefined) throw new Error("Invalid legacy import checkpoint");
      await compareContext(previous, native, entries, source.id, context);
      imported.set(source.id, { conversation: previous, entry: native });
      tips.set(previous.id, native.id);
      continue;
    }
    if (tips.get(conversation.id) !== prior.entry.id) {
      conversation = await conversation.fork(prior.entry.id, { ownership: { kind: "ownerless" }, init: async (tx, id) => {
        await initializeParentDocuments?.(tx, { id, parent: { conversationId: prior.conversation.id, at: prior.entry.id } });
        const binding = (await tx.doc(SessionBindings)).sessions[handle.address.sessionId];
        if (binding === undefined) throw new Error("Missing logical import binding");
        binding.retained.push(id);
      } }, context);
    }
    const native = await conversation.commit(async (tx) => {
      if (source.type === "model_change") await configure(tx, conversation.id, { model: { provider: source.provider, modelId: source.modelId } });
      if (source.type === "thinking_level_change") {
        const level = source.thinkingLevel;
        if (level !== "off" && level !== "minimal" && level !== "low" && level !== "medium" && level !== "high" && level !== "xhigh" && level !== "max") throw new LegacyImportError("Unsupported legacy thinking level");
        await configure(tx, conversation.id, { thinkingLevel: level });
      }
      const model = convertToLlm(sessionEntryToContextMessages(source));
      const kept = source.type === "compaction" ? imported.get(source.firstKeptEntryId)?.entry.id : undefined;
      if (source.type === "compaction" && kept === undefined) throw new LegacyImportError("Unsupported legacy compaction cut");
      const edited = source.type === "context_edit" ? imported.get(source.targetId)?.entry : undefined;
      if (source.type === "context_edit" && edited === undefined) throw new LegacyImportError("Unsupported legacy context edit target");
      const projection = source.type === "context_edit" ? buildSessionProjection(entries, source.id).entries.find((item) => item.sourceEntry.id === source.targetId) : undefined;
      const edits: ContextEdit[] = edited === undefined ? [] : [source.type === "context_edit" && source.replacement === null ? { target: edited.id, action: "omit" } : { target: edited.id, action: "replace", messages: convertToLlm(projection?.messages ?? []) }];
      const native = await tx.appendEntry(conversation.id, {
        kind: source.type === "compaction" ? "pi.compaction" : "forgerie.legacy-message",
        ...(model.length === 0 ? {} : { model }),
        ...(kept === undefined ? {} : { head: kept }),
        ...(edits.length === 0 ? {} : { edits }),
        data: { sdkEntryId: source.id },
      });
      (await tx.doc(LegacyTree)).aliases[source.id] = { conversationId: native.conversationId, entryId: native.id, messageIndex: 0 };
      await initializeParentDocuments?.(tx, { id: conversation.id });
      (await tx.doc(LegacyMigration)).count++;
      return native;
    }, context);
    imported.set(source.id, { conversation, entry: native });
    tips.set(conversation.id, native.id);
    await compareContext(conversation, native, entries, source.id, context);
  }
  const selected = manager.getLeafId() === null ? undefined : imported.get(manager.getLeafId() ?? "");
  // A tip selected before its last child needs an exact historical continuation.
  let selectedConversation = selected?.conversation ?? originConversation;
  const selectedEntry = selected?.entry ?? origin;
  if (!hadNativeHistory && tips.get(selectedConversation.id) !== selectedEntry.id) {
    selectedConversation = await selectedConversation.fork(selectedEntry.id, { ownership: { kind: "ownerless" }, init: async (tx, id) => {
      await initializeParentDocuments?.(tx, { id, parent: { conversationId: selectedConversation.id, at: selectedEntry.id } });
    } }, context);
  }
  await handle.harness.commit(async (tx) => {
    if (!hadNativeHistory) await bindSession(tx, bindings.journalId, handle.address.sessionId, selectedConversation.id);
    const progress = await tx.doc(LegacyMigration);
    if (progress.count !== entries.length) throw new Error("Legacy import count mismatch");
    progress.complete = true;
    delete progress.failure;
    (await tx.doc(OriginalImport)).complete = true;
  }, context);
}

function legacyEntries(entries: SessionEntry[], sessionId: string): SessionEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  if (byId.size !== entries.length) throw new LegacyImportError("Duplicate legacy SDK entry IDs");
  const kept = entries.filter((entry) => !isNativeProjection(entry, sessionId));
  const ids = new Set(kept.map((entry) => entry.id));
  return kept.map((entry) => {
    let parentId = entry.parentId;
    const visited = new Set([entry.id]);
    while (parentId !== null && !ids.has(parentId)) {
      if (visited.has(parentId)) throw new LegacyImportError("Legacy graph has a cycle or missing parent");
      visited.add(parentId);
      const ancestor = byId.get(parentId);
      if (ancestor === undefined) throw new LegacyImportError("Legacy graph has a cycle or missing parent");
      parentId = ancestor.parentId;
    }
    // SDK metadata and envelopes can follow native projection records. Remove only
    // the projection nodes, not the graph edge to their nearest retained ancestor.
    return { ...entry, parentId };
  });
}

function topological(entries: SessionEntry[]): SessionEntry[] {
  const pending = new Map(entries.map((entry) => [entry.id, entry]));
  if (pending.size !== entries.length) throw new LegacyImportError("Duplicate legacy SDK entry IDs");
  const result: SessionEntry[] = [];
  const seen = new Set<string>();
  while (pending.size > 0) {
    const size = pending.size;
    for (const [id, entry] of pending) if (entry.parentId === null || seen.has(entry.parentId)) { result.push(entry); seen.add(id); pending.delete(id); }
    if (size === pending.size) throw new LegacyImportError("Legacy graph has a cycle or missing parent");
  }
  return result;
}
function isNativeProjection(entry: SessionEntry, sessionId: string): boolean {
  const value = entry.type === "message" ? entry.message : entry.type === "custom_message" ? entry.details : undefined;
  return typeof value === "object" && value !== null && "forgerieDurableSessionId" in value && value.forgerieDurableSessionId === sessionId;
}
async function scanEntries(conversation: Conversation, context: Context): Promise<EntryRecord[]> {
  const entries: EntryRecord[] = [];
  let cursor: Cursor | undefined;
  do { const page = await conversation.entries({ order: "ascending" }, 256, cursor, context); entries.push(...page.items); cursor = page.next; } while (cursor !== undefined);
  return entries;
}
function nativeConversationId(value: number): Conversation["id"] {
  // IDs are created by native commits and read only from the saved alias map.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return value as Conversation["id"];
}

function completeToolRound(messages: ReturnType<typeof convertToLlm>): boolean {
  const calls = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant") for (const part of message.content) if (part.type === "toolCall") calls.add(part.id);
    if (message.role === "toolResult") calls.delete(message.toolCallId);
  }
  // Native context supplies interrupted results at historical cuts into a tool round.
  // Compare exact SDK messages only at safe round boundaries, never claim a mid-round match.
  return calls.size === 0;
}

async function compareContext(conversation: Conversation, native: EntryRecord, entries: SessionEntry[], sourceId: string, context: Context): Promise<void> {
  const expected = convertToLlm(buildSessionProjection(entries, sourceId).entries.flatMap((entry) => entry.messages));
  const actual = (await conversation.context(context, { at: native.id })).messages;
  if (completeToolRound(expected) && !isDeepStrictEqual(actual, expected)) throw new LegacyImportError(`Legacy context comparison failed at ${sourceId}; keep this session on legacy reads`);
}
