import type { JsonValue } from "@earendil-works/chord";
import { ATTENTION_HINT_CUSTOM_TYPE } from "../decisions/attentionHints.js";
import { decisionAnnotations } from "../decisions/optionalDecisionAnnotations.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";

/** Volatile sidecar only. Never submit optional information to Durable's commit line. */
export function readAttentionHint(handle: DurableSessionHandle): Promise<unknown> {
  return Promise.resolve(decisionAnnotations(handle.harness).read(String(handle.conversation.id), ATTENTION_HINT_CUSTOM_TYPE));
}
export function appendAttentionHint(handle: DurableSessionHandle, data: JsonValue): Promise<void> {
  return decisionAnnotations(handle.harness).write(String(handle.conversation.id), ATTENTION_HINT_CUSTOM_TYPE, data);
}
