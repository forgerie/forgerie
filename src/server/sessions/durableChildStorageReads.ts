import type { Context } from "@earendil-works/chord";
import type { ConversationId, JsonObject, Storage } from "@earendil-works/pi-durable";

/** Public Durable document reads. Missing and retired documents remain absent; no initial value is fabricated. */
export async function readChildDocument(storage: Storage, kind: string, conversationId: ConversationId | undefined, context: Context): Promise<JsonObject | undefined> {
  const record = await storage.findDocument({ kind, scope: conversationId === undefined ? { kind: "session" } : { kind: "conversation", conversationId } }, "current", context);
  if (record === undefined) return undefined;
  const document = await storage.document(record.id, "current", context);
  if (document === undefined) throw new Error(`Missing Durable document ${kind}`);
  return document.value;
}
