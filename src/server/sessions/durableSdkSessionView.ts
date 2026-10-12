import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Cursor, EntryId, EntryRecord, WatchHandle, Tx } from "@earendil-works/pi-durable";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { durableBrowserAppStateSchema, type DurableBrowserAppState } from "../../shared/durableBrowserSnapshot.js";
import { LegacyMigration, LegacyTree } from "./durableLegacyImport.js";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "../../shared/apiTypes.js";
import { ParentAskOutcomeSchema } from "./sessionResponse.js";
import { renderAskUserAnswersText } from "./sessionAsks.js";
import { Migration, ParentAsks, ParentAsksSchema, ParentResponse, ParentResponseSchema, Presentation, PresentationSchema, SessionName, SessionNameSchema, initializeParentDocuments } from "./durableParentDocuments.js";
import { durableJson } from "./durableJson.js";
import { importParentEntry } from "./durableParentStateImport.js";
import type { InitializeParentDocuments } from "./durableParentState.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";

const TargetSchema = Type.Object({ entryId: Type.Unsafe<EntryId>(Type.Integer({ minimum: 1 })) });

/** Native import invokes this seam after each original entry, inside that entry's commit. */
export function createDurableParentInitializer(manager: SessionManager): InitializeParentDocuments {
  return async (tx, conversation) => {
    await initializeParentDocuments(parentInitializationTx(tx), conversation);
    const tree = await tx.doc(LegacyTree);
    const progress = (await tx.doc(Migration)).appImportThrough[String(conversation.id)] ?? 0;
    const pending = Object.entries(tree.aliases).filter(([, target]) => target.conversationId === conversation.id && target.entryId > progress);
    if (pending.length === 0) return;
    // Replaying many old boundaries now would attach all app state to today's cut. Fail rather
    // than silently flatten already-imported historical metadata. Offline backfill owns that case.
    if (pending.length !== 1) throw new Error("Historical parent app-state backfill requires separate original commits");
    const [sdkId, target] = pending[0] ?? [];
    if (sdkId === undefined || target === undefined || !Check(TargetSchema, target)) throw new Error("Invalid imported parent entry target");
    const entries = new Map(manager.getEntries().map((entry) => [entry.id, entry]));
    const source = entries.get(sdkId);
    if (source === undefined) throw new Error(`Imported parent source ${sdkId} is missing`);
    const label = source.type === "label" ? tree.aliases[source.targetId] : undefined;
    if (label !== undefined && !Check(TargetSchema, label)) throw new Error("Invalid imported label target");
    const model = historicalModel(source, entries);
    await importParentEntry(tx, conversation, target.entryId, source, {
      ...(label === undefined ? {} : { labelTarget: label.entryId }), ...(model === undefined ? {} : { model }),
    });
  };
}

function historicalModel(source: SessionEntry, entries: ReadonlyMap<string, SessionEntry>): { provider: string; modelId: string } | undefined {
  const seen = new Set<string>();
  let entry: SessionEntry | undefined = source;
  while (entry !== undefined) {
    if (seen.has(entry.id)) throw new Error("Cyclic imported parent graph");
    seen.add(entry.id);
    if (entry.type === "model_change") return { provider: entry.provider, modelId: entry.modelId };
    entry = entry.parentId === null ? undefined : entries.get(entry.parentId);
  }
  return undefined;
}

/** Derived SDK/browser envelope cache. The entry owns content; documents own presentation facts. */
export class DurableSdkSessionView {
  private readonly envelopes = new Map<string, Static<typeof PresentationSchema>>();
  private readonly unsubscribe: () => void;
  private closed = false;
  private constructor(private readonly handle: DurableSessionHandle) {
    this.unsubscribe = handle.harness.subscribeCommits((publication) => {
      for (const change of publication.changes) {
        if (change.type !== "document" || change.conversationId !== handle.conversation.id || change.record.kind !== Presentation.definition.kind || change.record.key === undefined) continue;
        if (!Check(PresentationSchema, change.value)) throw new Error("Invalid committed parent presentation document");
        this.envelopes.set(change.record.key, change.value);
      }
    });
  }
  static async open(handle: DurableSessionHandle, context: Context): Promise<DurableSdkSessionView> {
    const view = new DurableSdkSessionView(handle);
    try { await view.refresh(context); return view; }
    catch (error) { view.close(); throw error; }
  }
  async refresh(context: Context): Promise<void> {
    if (this.closed) throw new Error("Durable SDK view is closed");
    let cursor: Cursor | undefined;
    do {
      const page = await this.handle.conversation.entries({ order: "ascending" }, 256, cursor, context);
      for (const entry of page.items) {
        const key = String(entry.id);
        const envelope = await this.handle.harness.snapshot(Presentation, this.handle.conversation.id, key, context);
        if (envelope === undefined) continue;
        if (!Check(PresentationSchema, envelope)) throw new Error("Invalid parent presentation document");
        this.envelopes.set(key, envelope);
      }
      cursor = page.next;
    } while (cursor !== undefined);
  }
  close(): void { if (!this.closed) { this.closed = true; this.unsubscribe(); this.envelopes.clear(); } }

  projectEntry(entry: EntryRecord): readonly unknown[] | undefined {
    const envelope = this.envelopes.get(String(entry.id))?.envelope;
    if (envelope === undefined) return undefined;
    const first = entry.model?.[0];
    let content = first?.content ?? (typeof entry.data === "object" && entry.data !== null && !Array.isArray(entry.data) ? entry.data["content"] : undefined);
    if (envelope.type === "custom") {
      if (envelope.display !== true) return [];
      if (content === undefined && envelope.customType === ASK_USER_ANSWERS_CUSTOM_TYPE && Check(ParentAskOutcomeSchema, envelope.details)) content = renderAskUserAnswersText(envelope.details);
      if (content === undefined) throw new Error("Native custom presentation has no content");
      return [{ role: "custom", customType: envelope.customType, content, details: envelope.details, ...(first === undefined ? {} : { timestamp: first.timestamp }) }];
    }
    // Excluded shell records need their one display-only output on the native entry. Never
    // recover a missing shell envelope from an SDK file or guess at an unrelated model message.
    const raw = typeof entry.data === "object" && entry.data !== null && !Array.isArray(entry.data) ? entry.data["output"] : undefined;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.flatMap((part) => typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string" ? [part.text] : []).join("\n") : "";
    const prefix = `Ran \`${envelope.command ?? ""}\`\n`;
    const start = prefix.length + 4;
    const end = text.lastIndexOf("\n```");
    const output = typeof raw === "string" ? raw : text.startsWith(prefix + "```\n") && end >= start ? text.slice(start, end) : text.startsWith(prefix + "(no output)") ? "" : undefined;
    if (output === undefined) throw new Error("Native shell presentation has no recoverable output");
    return [{ role: "bashExecution", ...envelope, output, ...(first === undefined ? {} : { timestamp: first.timestamp }) }];
  }

  async appWatch(context: Context): Promise<WatchHandle<DurableBrowserAppState>> {
    const asks = await this.handle.harness.watchDoc(ParentAsks, this.handle.conversation.id, context);
    const response = await this.handle.harness.watchDoc(ParentResponse, this.handle.conversation.id, context);
    const name = await this.handle.harness.watchDoc(SessionName, this.handle.conversation.id, context);
    if (asks === undefined || response === undefined || name === undefined) {
      await Promise.all([asks?.stop(), response?.stop(), name?.stop()]);
      throw new Error("Parent documents must exist before browser attachment");
    }
    let askValue = asks.value, responseValue = response.value, nameValue = name.value;
    const project = () => {
      if (!Check(ParentAsksSchema, askValue) || !Check(ParentResponseSchema, responseValue) || !Check(SessionNameSchema, nameValue)) throw new Error("Invalid parent app snapshot");
      const intent = responseValue.intent;
      return durableBrowserAppStateSchema.parse({ ...(nameValue.name === undefined ? {} : { sessionName: nameValue.name }),
        ...(askValue.pending === undefined ? {} : { pendingAsk: askValue.pending }),
        response: askValue.pending !== undefined ? { kind: "needs-response", reason: "questions" }
          : intent === "nothing" ? { kind: "none" } : { kind: "needs-response", reason: intent === "questions" ? "reply" : intent } });
    };
    let value = project();
    let line = Promise.resolve();
    let stopped = false;
    const stop = async () => { stopped = true; return (await Promise.all([asks.stop(), response.stop(), name.stop()]))[0]; };
    const closed = Promise.race([asks.closed, response.closed, name.closed]).then(async (end) => { await stop(); return end; });
    return { get value() { return value; }, closed, stop,
      start(listener) {
        const publish = () => { line = line.then(async () => { if (stopped) return; value = project(); await listener(value, [["r", durableJson(value)]], BACKGROUND_CONTEXT); }); return line; };
        asks.start(async (next) => { askValue = next; await publish(); });
        response.start(async (next) => { responseValue = next; await publish(); });
        name.start(async (next) => { nameValue = next; await publish(); });
      },
    };
  }
}

/** #43 preserves the original receipt; #45 owns its v2 upgrade. Never open two versions of
 * the same document in one transaction, and never let this compatibility view write it. */
function parentInitializationTx(tx: Tx): Tx {
  return new Proxy(tx, { get(target, property) {
    if (property === "doc") return async (...args: unknown[]): Promise<unknown> => {
      const token = args[0];
      if (typeof token === "object" && token !== null && "definition" in token && typeof token.definition === "object" && token.definition !== null
        && "kind" in token.definition && token.definition.kind === "forgerie.import" && "version" in token.definition && token.definition.version === 1) {
        if (args.length !== 1) throw new Error("Unsupported legacy receipt address");
        const receipt = await target.doc(LegacyMigration);
        return Object.freeze({ complete: receipt.complete || receipt.legacyProjectionComplete });
      }
      const doc = target.doc.bind(target);
      const result: unknown = Reflect.apply(doc, target, args);
      return result;
    };
    const value: unknown = Reflect.get(target, property, target);
    if (typeof value !== "function") return value;
    const bound: unknown = value.bind(target);
    return bound;
  } });
}
