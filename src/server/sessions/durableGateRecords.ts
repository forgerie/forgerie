import type { JsonValue } from "@earendil-works/chord";
import { defineDoc, type ConversationId, type JsonObject, type Tx } from "@earendil-works/pi-durable";
import type { GatedCategory } from "../../shared/autonomyPolicy.js";

/** The gate document alone, so readers such as the workflow stall check need not load the gate hook and its imports. */
export const GATED_ACTIONS_DOC_KIND = "forgerie.gated-actions";
/* eslint-disable @typescript-eslint/consistent-type-definitions */
export type GateRecord = { id: string; conversationId: ConversationId; by: string; tool: string; args: JsonObject; category: GatedCategory; description: string; requestedAt: number;
  state: {kind: "waiting" | "approved" | "refused"} | {kind: "ran"; result: JsonValue; at: number} | {kind: "failed"; error: string; at: number} };
/* eslint-enable @typescript-eslint/consistent-type-definitions */
export const Gates = defineDoc<{ records: Record<string, GateRecord>; cwd: Record<string, string>; nestedTools?: Record<string, string> }>({
  kind: GATED_ACTIONS_DOC_KIND, version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({records: {}, cwd: {}}),
});
/** Whether a gated action in this parent's family waits for the user. */
export async function gateWaitsInTx(tx: Tx, parent: ConversationId): Promise<boolean> {
  return Object.values((await tx.doc(Gates, parent)).records).some(gate => gate.state.kind === "waiting");
}
