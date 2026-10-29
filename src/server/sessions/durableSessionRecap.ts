import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { InboxDoc, LiveDoc, UsageDoc, type Cursor, type EntryRecord, type Tx } from "@earendil-works/pi-durable";
import type { Usage } from "@earendil-works/pi-ai";
import { RECAP_ENTRY_KIND, recapDataSchema, type RecapData } from "../../shared/sessionRecap.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";
import { endTurnReplyMessage } from "./endTurnReply.js";
import { isTranscriptEntry } from "./durableSessionJournal.js";
import { isHostEntryKind } from "./durableHostEntries.js";
import { recapExchanges } from "./sessionRecapGenerator.js";
import { SessionBindings } from "./durableSessionBindings.js";

const LEGACY_MESSAGE_KIND = "forgerie.legacy-message";

export async function readRecapHistory(handle: DurableSessionHandle) {
  const entries: EntryRecord[] = [];
  let cursor: Cursor | undefined;
  do {
    const page = await handle.conversation.entries({ order: "ascending" }, 256, cursor, context);
    entries.push(...page.items); cursor = page.next;
  } while (cursor !== undefined);
  const lastRecapEntry = [...entries].reverse().find(entry => entry.kind === RECAP_ENTRY_KIND);
  const parsed = recapDataSchema.safeParse(lastRecapEntry?.data);
  const lastRecap = parsed.success ? parsed.data : undefined;
  const messagesOf = (values: EntryRecord[]) => values.flatMap(entry => {
    const reply = endTurnReplyMessage(entry);
    if (reply !== undefined) return [reply];
    // Imported history is ordinary conversation: the browser shows it, so the recap reads it too.
    if (entry.kind === LEGACY_MESSAGE_KIND) return entry.model ?? [];
    return isTranscriptEntry(entry.kind) && !isHostEntryKind(entry.kind) ? entry.model ?? [] : [];
  });
  const messages = messagesOf(entries);
  const exchanges = recapExchanges(messages);
  const view = await handle.conversation.viewState(context);
  const child = view.value.conversation.owner !== undefined;
  view.dispose();
  return {
    child, messages, leafId: entries.at(-1)?.id,
    newestEntryId: String([...entries].reverse().find(entry => entry.kind !== RECAP_ENTRY_KIND)?.id ?? ""),
    lastRecap,
    completedTurns: exchanges.filter(exchange => exchange.assistant !== "").length,
    newTurns: recapExchanges(messagesOf(entries.filter(entry => lastRecapEntry === undefined || entry.id > lastRecapEntry.id))).length,
    hasExchange: exchanges.length > 0,
  };
}

/** Usage is charged even when the answer is rejected or freshness prevents saving it. */
export async function recordRecapUsage(tx: Tx, handle: DurableSessionHandle, model: string, usage: Usage | undefined): Promise<void> {
  if (usage === undefined) return;
  const ledger = await tx.doc(UsageDoc, handle.conversation.id), old = ledger.models[model];
  ledger.models[model] = {
    input: (old?.input ?? 0) + usage.input, output: (old?.output ?? 0) + usage.output,
    cacheRead: (old?.cacheRead ?? 0) + usage.cacheRead, cacheWrite: (old?.cacheWrite ?? 0) + usage.cacheWrite,
    totalTokens: (old?.totalTokens ?? 0) + usage.totalTokens,
    ...(usage.reasoning === undefined && old?.reasoning === undefined ? {} : { reasoning: (old?.reasoning ?? 0) + (usage.reasoning ?? 0) }),
    ...(usage.cacheWrite1h === undefined && old?.cacheWrite1h === undefined ? {} : { cacheWrite1h: (old?.cacheWrite1h ?? 0) + (usage.cacheWrite1h ?? 0) }),
    cost: { input: (old?.cost.input ?? 0) + usage.cost.input, output: (old?.cost.output ?? 0) + usage.cost.output,
      cacheRead: (old?.cost.cacheRead ?? 0) + usage.cost.cacheRead, cacheWrite: (old?.cost.cacheWrite ?? 0) + usage.cost.cacheWrite, total: (old?.cost.total ?? 0) + usage.cost.total },
  };
}

/** The freshness check and data-only append share one transaction with native admission. */
export async function commitSessionRecap(handle: DurableSessionHandle, leafId: EntryRecord["id"] | undefined,
  data: RecapData | undefined, usage: Usage | undefined, model: string): Promise<boolean> {
  return handle.conversation.commit(async tx => {
    await recordRecapUsage(tx, handle, model, usage);
    if (data === undefined) return false;
    const live = await tx.doc(LiveDoc, handle.conversation.id), inbox = await tx.doc(InboxDoc, handle.conversation.id);
    const newest = await tx.scanEntries({ conversationId: handle.conversation.id, order: "descending" }, 1);
    const binding = (await tx.doc(SessionBindings)).sessions[handle.address.sessionId];
    const record = await tx.conversation(handle.conversation.id);
    if (record?.owner !== undefined || live.run !== undefined || (live.compactions?.length ?? 0) > 0 || inbox.items.length > 0 || newest.items[0]?.id !== leafId
      || binding !== undefined && binding.conversationId !== handle.conversation.id) return false;
    await tx.appendEntry(handle.conversation.id, { kind: RECAP_ENTRY_KIND, data: recapDataSchema.parse(data) });
    return true;
  }, context);
}
