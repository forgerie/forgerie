import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { InboxDoc, LiveDoc, UsageDoc, type Cursor, type EntryRecord, type Tx } from "@earendil-works/pi-durable";
import type { Usage } from "@earendil-works/pi-ai";
import { RECAP_ENTRY_KIND, recapDataSchema, type RecapData } from "../../shared/sessionRecap.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";
import { recapExchanges } from "./sessionRecapGenerator.js";
import { durableEntryPresentationId } from "./durableNativeHistory.js";
import { extractSearchMessage } from "./sessionSearchText.js";
import { SessionBindings } from "./durableSessionBindings.js";

/** The parts of a projected SDK session entry that a recap reads. */
export interface RecapBranchEntry { id?: string; type: string; message?: unknown; customType?: string }

/**
 * Conversation comes from the session's projected SDK branch, the same source as session search: only
 * `message` entries with user or assistant text count. Custom messages, notifications, shell runs, branch
 * summaries and compactions have their own entry types there, for native and imported history alike.
 * Durable entries decide only freshness: the leaf, the newest entry, and the last saved recap.
 *
 * The branch must describe the same history as the leaf that later guards the commit. The leaf is read
 * before the branch and again after the scan; if a turn landed in between, the result is `undefined`.
 */
export async function readRecapHistory(handle: DurableSessionHandle, readBranch: () => Promise<readonly RecapBranchEntry[]>, seenThrough?: string,
  sdkEntryId?: (entry: EntryRecord, index: number) => string | undefined) {
  const leafBefore = (await handle.conversation.entries({ order: "descending" }, 1, undefined, context)).items[0]?.id;
  const branch = await readBranch();
  const entries: EntryRecord[] = [];
  let cursor: Cursor | undefined;
  do {
    const page = await handle.conversation.entries({ order: "ascending" }, 256, cursor, context);
    entries.push(...page.items); cursor = page.next;
  } while (cursor !== undefined);
  if (entries.at(-1)?.id !== leafBefore) return undefined;
  const lastRecapEntry = [...entries].reverse().find(entry => entry.kind === RECAP_ENTRY_KIND);
  const parsed = recapDataSchema.safeParse(lastRecapEntry?.data);
  const lastRecap = parsed.success ? parsed.data : undefined;
  const messagesOf = (values: readonly RecapBranchEntry[]) => values.flatMap(entry => entry.type === "message" ? [entry.message] : []);
  const messages = messagesOf(branch);
  const exchanges = recapExchanges(messages);
  const recapAt = branch.map(entry => entry.type === "custom_message" && entry.customType === RECAP_ENTRY_KIND).lastIndexOf(true);
  // Browser IDs are Durable presentation IDs; the projected branch uses SDK IDs.
  const presentationIds = new Map<string, string>();
  for (const entry of entries) for (let index = 0; index < Math.max(1, entry.model?.length ?? 0); index++) {
    const sdk = sdkEntryId?.(entry, index);
    if (sdk !== undefined) presentationIds.set(sdk, durableEntryPresentationId(handle.address.journalId, entry, index));
  }
  const branchIds = branch.map(entry => entry.id === undefined ? undefined : presentationIds.get(entry.id) ?? entry.id);
  const seenAt = seenThrough === undefined ? -1 : branchIds.indexOf(seenThrough);
  const unseenAfter = seenAt < 0 ? recapAt : seenAt;
  let unseenTurns = 0, longestUnseenReply = 0;
  let hasUser = false, lastAnswer = -1;
  for (const [index, entry] of branch.entries()) {
    const visible = entry.type === "message" ? extractSearchMessage({ type: "message", id: entry.id ?? "", message: entry.message }) : undefined;
    if (visible?.role === "user") {
      if (lastAnswer >= 0) {
        if (lastAnswer > unseenAfter) unseenTurns++;
        lastAnswer = -1;
      }
      hasUser = true;
    } else if (visible?.role === "assistant") {
      if (hasUser) lastAnswer = index;
      if (index > unseenAfter) longestUnseenReply = Math.max(longestUnseenReply, visible.text.trim().length);
    }
  }
  if (lastAnswer > unseenAfter) unseenTurns++;
  const view = await handle.conversation.viewState(context);
  const child = view.value.conversation.owner !== undefined;
  view.dispose();
  return {
    child, messages, branchIds, unseenTurns, longestUnseenReply, leafId: entries.at(-1)?.id,
    newestEntryId: String([...entries].reverse().find(entry => entry.kind !== RECAP_ENTRY_KIND)?.id ?? ""),
    lastRecap,
    completedTurns: exchanges.filter(exchange => exchange.assistant !== "").length,
    newTurns: recapExchanges(messagesOf(branch.slice(recapAt + 1))).length,
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
