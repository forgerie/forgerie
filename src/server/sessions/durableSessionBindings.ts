import { defineDoc, type ConversationId, type Harness, type Tx } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

const NativeId = Type.Integer({ minimum: 0 });
const BindingSchema = Type.Object({
  conversationId: NativeId,
  retained: Type.Array(NativeId),
  parentSessionId: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });
export const SessionBindingsSchema = Type.Object({
  journalId: Type.String(),
  sessions: Type.Record(Type.String(), BindingSchema),
}, { additionalProperties: false });
export const SessionBindings = defineDoc({
  kind: "forgerie.session-bindings", version: 1, scope: "session",
  initial: (): Static<typeof SessionBindingsSchema> => ({ journalId: "", sessions: {} }),
});

export async function readSessionBindings(harness: Harness, context: Context) {
  const value = await harness.snapshot(SessionBindings, context);
  if (!Check(SessionBindingsSchema, value) || value.journalId === "") throw new Error("Invalid or missing Durable session bindings");
  return value;
}

export async function bindSession(tx: Tx, journalId: string, sessionId: string, conversationId: ConversationId, parentSessionId?: string): Promise<void> {
  if (sessionId.trim() === "" || journalId.trim() === "") throw new Error("Durable identities must not be empty");
  const state = await tx.doc(SessionBindings);
  if (state.journalId !== "" && state.journalId !== journalId) throw new Error("Foreign Durable journal identity");
  state.journalId = journalId;
  const old = state.sessions[sessionId];
  if (old !== undefined && parentSessionId !== undefined) throw new Error("Logical session already exists");
  const retained = [...old?.retained ?? []];
  if (!retained.includes(conversationId)) retained.push(conversationId);
  state.sessions[sessionId] = { conversationId, retained,
    ...(parentSessionId === undefined ? old?.parentSessionId === undefined ? {} : { parentSessionId: old.parentSessionId } : { parentSessionId }) };
}

/** Numeric brands are reconstructed only after persisted schema validation. */
export function boundConversationId(value: number): ConversationId {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid native conversation ID");
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return value as ConversationId;
}
