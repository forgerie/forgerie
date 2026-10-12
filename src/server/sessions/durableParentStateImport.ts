import { copyJson } from "@earendil-works/chord";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ConversationRecord, EntryId, Tx } from "@earendil-works/pi-durable";
import { Check } from "typebox/value";
import { ChildRunUsageSchema } from "../../shared/childRuns.js";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "../../shared/apiTypes.js";
import { ExtensionEntries, ImportedUsage, Labels, ParentAsks, ParentResponse, Presentation, SessionName, Migration } from "./durableParentDocuments.js";
import { durableJson } from "./durableJson.js";
import { ParentAskOutcomeSchema, SESSION_RESPONSE_CUSTOM_TYPE, responseAfterEntry, type ResponseProjection } from "./sessionResponse.js";
import { askAnswerRequestId, createAskDelivery } from "./durableAskDelivery.js";

/** One original SDK boundary per commit. The graph importer supplies a visible mapped label target before writes. */
export async function importParentEntry(tx: Tx, conversation: ConversationRecord, nativeEntryId: EntryId, entry: SessionEntry,
  options: { labelTarget?: EntryId; model?: { provider: string; modelId: string } } = {}): Promise<void> {
  const id = conversation.id;
  const progress = await tx.doc(Migration);
  const importedThrough = progress.appImportThrough[String(id)];
  // The graph importer reuses original native markers and visits each path in ascending boundary order.
  if (importedThrough !== undefined && nativeEntryId <= importedThrough) return;
  progress.appImportThrough[String(id)] = nativeEntryId;
  const asks = await tx.doc(ParentAsks, id);
  const response = await tx.doc(ParentResponse, id);
  const current: ResponseProjection = { ...(response.protocol === true ? { protocol: true } : {}), undeclaredRun: response.undeclaredRun,
    response: response.intent === "nothing" ? { kind: "none" } : { kind: "needs-response", reason: response.intent === "questions" ? "questions" : response.intent },
    ...(asks.pending === undefined ? {} : { pendingAsk: asks.pending }) };
  const next = responseAfterEntry(current, entry);
  response.intent = next.response.kind === "none" ? "nothing" : next.response.reason;
  response.undeclaredRun = next.undeclaredRun === true;
  if (next.protocol === true) response.protocol = true;
  if (next.pendingAsk === undefined) delete asks.pending; else asks.pending = next.pendingAsk;
  if (entry.type === "message" && entry.message.role === "user") response.missingReplyRetry = "available";
  if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "end_turn" && entry.message.isError
    && entry.message.content.some(part => part.type === "text" && part.text.startsWith("The user sees no reply:"))) response.missingReplyRetry = "spent";

  if (entry.type === "custom") {
    const doc = await tx.doc(ExtensionEntries, id, entry.customType, null);
    if (!doc.entries.some(item => item.id === entry.id)) doc.entries.push({ id: entry.id, nativeEntryId, timestamp: entry.timestamp,
      ...(entry.data === undefined ? {} : { data: copyJson(entry.data) }) });
    if (entry.customType === SESSION_RESPONSE_CUSTOM_TYPE && typeof entry.data === "object" && entry.data !== null && "kind" in entry.data && entry.data.kind === "answered" && "outcome" in entry.data) {
      const outcome = entry.data.outcome;
      if (Check(ParentAskOutcomeSchema, outcome) && asks.closed[outcome.askId] === undefined) {
        const deliver = outcome.reason === "submitted" || outcome.reason === "cancelled";
        asks.closed[outcome.askId] = { outcome, delivery: deliver ? { kind: "pending", requestId: askAnswerRequestId(outcome.askId) } : { kind: "none" } };
        if (deliver) await createAskDelivery(tx, outcome.askId);
      }
    }
  }
  if (entry.type === "session_info") {
    const doc = await tx.doc(SessionName, id);
    if (entry.name === undefined) delete doc.name; else doc.name = entry.name;
  }
  if (entry.type === "label") {
    const doc = await tx.doc(Labels, id);
    if (entry.label === undefined) Reflect.deleteProperty(doc.entries, entry.targetId);
    else {
      if (options.labelTarget === undefined) throw new Error(`Missing visible native target for imported label ${entry.targetId}`);
      doc.entries[entry.targetId] = { nativeEntryId: options.labelTarget, label: entry.label };
    }
  }
  if (entry.type === "custom_message") {
    (await tx.doc(Presentation, id, String(nativeEntryId), null)).envelope = { type: "custom", customType: entry.customType, display: entry.display,
      ...(entry.details === undefined ? {} : { details: durableJson(entry.details) }) };
    if (entry.customType === ASK_USER_ANSWERS_CUSTOM_TYPE && Check(ParentAskOutcomeSchema, entry.details)) {
      asks.closed[entry.details.askId] = { outcome: entry.details, delivery: { kind: "none" } };
    }
  }
  if (entry.type === "message" && entry.message.role === "bashExecution") {
    const message = entry.message;
    (await tx.doc(Presentation, id, String(nativeEntryId), null)).envelope = { type: "bashExecution", command: message.command,
      ...(message.exitCode === undefined ? {} : { exitCode: message.exitCode }), cancelled: message.cancelled, truncated: message.truncated,
      ...(message.fullOutputPath === undefined ? {} : { fullOutputPath: message.fullOutputPath }), excludeFromContext: message.excludeFromContext === true };
  }
  const message = entry.type === "message" && entry.message.role === "assistant" ? entry.message : undefined;
  // A complete native projection stamp means pi.usage already owns this spend. Never recover it from assistant copies.
  if (message !== undefined && "forgerieDurableEntryId" in message && typeof message.forgerieDurableEntryId === "number"
    && "forgerieDurableSessionId" in message && typeof message.forgerieDurableSessionId === "string") return;
  const usage = message?.usage ?? (entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary" ? entry.usage : undefined);
  if (usage === undefined) return;
  if (!Check(ChildRunUsageSchema, usage)) throw new Error(`Invalid imported usage in ${entry.id}`);
  const model = message === undefined ? entry.type === "usage" ? { provider: entry.provider, modelId: entry.model } : options.model
    : { provider: message.provider, modelId: message.model };
  if (model === undefined) throw new Error(`Missing model for imported usage in ${entry.id}`);
  const baseline = await tx.doc(ImportedUsage, id);
  if (baseline.sourceEntryIds.includes(entry.id)) return;
  const key = `${model.provider}/${model.modelId}`;
  const previous = baseline.usage.models[key];
  const sum = (value: number, prior = 0): number => value + prior;
  baseline.usage.models[key] = { input: sum(usage.input, previous?.input), output: sum(usage.output, previous?.output),
    cacheRead: sum(usage.cacheRead, previous?.cacheRead), cacheWrite: sum(usage.cacheWrite, previous?.cacheWrite), totalTokens: sum(usage.totalTokens, previous?.totalTokens),
    ...(usage.reasoning === undefined && previous?.reasoning === undefined ? {} : { reasoning: sum(usage.reasoning ?? 0, previous?.reasoning) }),
    ...(usage.cacheWrite1h === undefined && previous?.cacheWrite1h === undefined ? {} : { cacheWrite1h: sum(usage.cacheWrite1h ?? 0, previous?.cacheWrite1h) }),
    cost: { input: sum(usage.cost.input, previous?.cost.input), output: sum(usage.cost.output, previous?.cost.output), cacheRead: sum(usage.cost.cacheRead, previous?.cost.cacheRead),
      cacheWrite: sum(usage.cost.cacheWrite, previous?.cost.cacheWrite), total: sum(usage.cost.total, previous?.cost.total) } };
  baseline.sourceEntryIds.push(entry.id);
}
