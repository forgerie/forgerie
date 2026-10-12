import type { Context } from "@earendil-works/chord";
import type { Conversation, ConversationId, EntryId, Harness } from "@earendil-works/pi-durable";
import { isAbsolute } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { boundConversationId, readSessionBindings } from "./durableSessionBindings.js";

export const DurableSessionAddressSchema = Type.Object({
  journalId: Type.String({ minLength: 1 }),
  databasePath: Type.String({ minLength: 1 }),
  sessionId: Type.String({ minLength: 1 }),
  conversationId: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

/** Locators are filesystem capabilities; do not accept relative or NUL paths. */
export function parseDurableSessionAddress(value: unknown): DurableSessionAddress {
  if (!Check(DurableSessionAddressSchema, value) || !isAbsolute(value.databasePath) || value.databasePath.includes("\u0000")) {
    throw new Error("Invalid Durable session locator");
  }
  return { ...value, conversationId: boundConversationId(value.conversationId) };
}

// Shared seam uses the type alias specified in the approved brief.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type DurableSessionAddress = {
  journalId: string;
  databasePath: string;
  sessionId: string;
  conversationId: ConversationId;
};

// Shared seam uses the type alias specified in the approved brief.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type DurableEntryTarget = {
  journalId: string;
  conversationId: ConversationId;
  entryId: EntryId;
  messageIndex: number;
};

/** Rebuild a missed catalog publication from committed family bindings. Never schedule work. */
export async function durableFamilyAddresses(handle: DurableSessionHandle, context: Context): Promise<DurableSessionAddress[]> {
  const state = await readSessionBindings(handle.harness, context);
  if (state.journalId !== handle.address.journalId) throw new Error("Foreign Durable journal identity");
  return Object.entries(state.sessions).map(([sessionId, binding]) => ({
    databasePath: handle.address.databasePath, journalId: state.journalId, sessionId,
    conversationId: boundConversationId(binding.conversationId),
  }));
}

export interface DurableSessionHandle {
  readonly address: DurableSessionAddress;
  readonly harness: Harness;
  readonly conversation: Conversation;
  release(context: Context): Promise<void>;
}
