import { defineDoc, defineDocFamily, type ConversationRecord, type EntryId, type Tx } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import { Type, type Static } from "typebox";
import { ChildRunUsageStateSchema } from "../../shared/childRuns.js";
import { ParentAskOutcomeSchema, PendingParentAskSchema } from "./sessionResponse.js";

// Brands are restored only after the persisted integer has passed schema validation.
const NativeEntryId = Type.Unsafe<EntryId>(Type.Integer({ minimum: 1 }));
const Json = Type.Unsafe<JsonValue>(Type.Cyclic({ value: Type.Union([
  Type.Null(), Type.Boolean(), Type.Number(), Type.String(), Type.Array(Type.Ref("value")), Type.Record(Type.String(), Type.Ref("value")),
]) }, "value"));
export const ParentAsksSchema = Type.Object({
  pending: Type.Optional(PendingParentAskSchema),
  closed: Type.Record(Type.String(), Type.Object({
    outcome: ParentAskOutcomeSchema,
    delivery: Type.Union([
      Type.Object({ kind: Type.Literal("none") }),
      Type.Object({ kind: Type.Literal("pending"), requestId: Type.String() }),
      Type.Object({ kind: Type.Literal("admitted"), requestId: Type.String(), submissionId: Type.Integer({ minimum: 1 }) }),
    ]),
  })),
});
export const ParentResponseSchema = Type.Object({
  intent: Type.Union([Type.Literal("nothing"), Type.Literal("reply"), Type.Literal("questions"), Type.Literal("undeclared")]),
  undeclaredRun: Type.Boolean(), protocol: Type.Optional(Type.Literal(true)),
  missingReplyRetry: Type.Union([Type.Literal("available"), Type.Literal("spent")]),
});
export const LabelsSchema = Type.Object({ entries: Type.Record(Type.String(), Type.Object({ nativeEntryId: NativeEntryId, label: Type.String() })) });
export const SessionNameSchema = Type.Object({ name: Type.Optional(Type.String()) });
export const ExtensionEntriesSchema = Type.Object({ entries: Type.Array(Type.Object({
  id: Type.String(), nativeEntryId: NativeEntryId, timestamp: Type.String(), data: Type.Optional(Json),
})) });
export const PresentationSchema = Type.Object({ envelope: Type.Optional(Type.Object({
  type: Type.Union([Type.Literal("custom"), Type.Literal("bashExecution")]),
  customType: Type.Optional(Type.String()), display: Type.Optional(Type.Boolean()), details: Type.Optional(Json),
  command: Type.Optional(Type.String()), exitCode: Type.Optional(Type.Number()), cancelled: Type.Optional(Type.Boolean()),
  truncated: Type.Optional(Type.Boolean()), fullOutputPath: Type.Optional(Type.String()), excludeFromContext: Type.Optional(Type.Boolean()),
})) });
export const HandoffSchema = Type.Object({ operation: Type.Optional(Type.Object({
  sourceSessionId: Type.String(), destinationSessionId: Type.String(), documentPath: Type.String(),
  phase: Type.Union([Type.Literal("preparing"), Type.Literal("delivering"), Type.Literal("delivered")]), receipt: Type.Optional(Type.String()),
})) });
export const NoticeReceiptsSchema = Type.Object({ receipts: Type.Record(Type.String(), Type.Boolean()) });
export const ImportedUsageSchema = Type.Object({ sourceEntryIds: Type.Array(Type.String()), usage: ChildRunUsageStateSchema });
export const MigrationSchema = Type.Object({
  legacyImportComplete: Type.Boolean(), version: Type.Integer({ minimum: 0 }),
  sources: Type.Record(Type.String(), Type.Object({ sha256: Type.String(), bytes: Type.Integer({ minimum: 0 }) })),
  completionReceipt: Type.Optional(Type.String()), verifiedExportBoundary: Type.Optional(Type.String()),
  appImportThrough: Type.Record(Type.String(), NativeEntryId),
});

export const ParentAsks = defineDoc<Static<typeof ParentAsksSchema>>({ kind: "forgerie.parent-asks", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ closed: {} }) });
export const ParentResponse = defineDoc<Static<typeof ParentResponseSchema>>({ kind: "forgerie.parent-response", version: 1, scope: "conversation", history: "rewindable", fork: "asOf", initial: () => ({ intent: "nothing", undeclaredRun: false, missingReplyRetry: "available" }) });
export const Labels = defineDoc<Static<typeof LabelsSchema>>({ kind: "forgerie.labels", version: 1, scope: "conversation", history: "latest", fork: "current", initial: () => ({ entries: {} }) });
export const SessionName = defineDoc<Static<typeof SessionNameSchema>>({ kind: "forgerie.session-name", version: 1, scope: "conversation", history: "latest", fork: "current", initial: () => ({}) });
export const ExtensionEntries = defineDocFamily<Static<typeof ExtensionEntriesSchema>, null>({ kind: "forgerie.extension-entries", version: 1, scope: "conversation", family: true, history: "rewindable", fork: "asOf", initial: () => ({ entries: [] }) });
export const Presentation = defineDocFamily<Static<typeof PresentationSchema>, null>({ kind: "forgerie.presentation", version: 1, scope: "conversation", family: true, history: "rewindable", fork: "asOf", initial: () => ({}) });
export const Handoff = defineDoc<Static<typeof HandoffSchema>>({ kind: "forgerie.handoff", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({}) });
export const NoticeReceipts = defineDoc<Static<typeof NoticeReceiptsSchema>>({ kind: "forgerie.notice-receipts", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ receipts: {} }) });
export const ImportedUsage = defineDoc<Static<typeof ImportedUsageSchema>>({ kind: "forgerie.imported-usage", version: 1, scope: "conversation", history: "rewindable", fork: "asOf", initial: () => ({ sourceEntryIds: [], usage: { models: {}, tools: {} } }) });
export const Migration = defineDoc<Static<typeof MigrationSchema>>({ kind: "forgerie.migration", version: 1, scope: "session", initial: () => ({ legacyImportComplete: false, version: 0, sources: {}, appImportThrough: {} }) });

const LegacyImportReceipt = defineDoc<{ complete: boolean }>({ kind: "forgerie.import", version: 1, scope: "session", initial: () => ({ complete: false }) });

/** Called inside create/fork/import commits. It does not start work or change built-in, child, or workflow documents. */
export async function initializeParentDocuments(tx: Tx, conversation: ConversationRecord): Promise<void> {
  await tx.doc(ParentAsks, conversation.id);
  await tx.doc(ParentResponse, conversation.id);
  await tx.doc(SessionName, conversation.id);
  await tx.doc(Handoff, conversation.id);
  await tx.doc(NoticeReceipts, conversation.id);
  await tx.doc(ImportedUsage, conversation.id);
  const migration = await tx.doc(Migration);
  // Keep the original import receipt intact while recording its meaning in the versioned migration document.
  if ((await tx.doc(LegacyImportReceipt)).complete) migration.legacyImportComplete = true;
  const labels = await tx.doc(Labels, conversation.id);
  if (conversation.parent !== undefined) {
    // Labels can only target entries visible in their owning conversation. Native IDs increase along every path.
    // Do not read tables here: creation has already written the conversation and disallows table reads.
    for (const [id, value] of Object.entries(labels.entries)) if (value.nativeEntryId > conversation.parent.at) Reflect.deleteProperty(labels.entries, id);
  }
}
