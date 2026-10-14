import { randomUUID } from "node:crypto";
import type { JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { ATTENTION_HINT_CUSTOM_TYPE } from "../decisions/attentionHints.js";
import { ExtensionEntries } from "./durableParentDocuments.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";

export async function readAttentionHint(handle: DurableSessionHandle): Promise<unknown> {
  const stored = await handle.harness.snapshot(ExtensionEntries, handle.conversation.id, ATTENTION_HINT_CUSTOM_TYPE, context);
  return stored?.entries[stored.entries.length - 1]?.data;
}

/** Same rewindable metadata family as the response. Optional writes must not poison
 * ParentState's SDK intent queue and make a later end_turn declaration fail.
 */
export async function appendAttentionHint(handle: DurableSessionHandle, data: JsonValue): Promise<void> {
  await handle.conversation.commit(async (tx) => {
    const id = randomUUID();
    const marker = await tx.appendEntry(handle.conversation.id, { kind: "forgerie.app-state", data: { sdkEntryId: id, change: "custom-entry", customType: ATTENTION_HINT_CUSTOM_TYPE } });
    const stored = await tx.doc(ExtensionEntries, handle.conversation.id, ATTENTION_HINT_CUSTOM_TYPE, null);
    stored.entries.push({ id, nativeEntryId: marker.id, timestamp: new Date().toISOString(), data });
  }, context);
}
