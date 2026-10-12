import type { Context } from "@earendil-works/chord";
import type { Conversation, ConversationId, EntryId, Harness } from "@earendil-works/pi-durable";

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

export interface DurableSessionHandle {
  readonly address: DurableSessionAddress;
  readonly harness: Harness;
  readonly conversation: Conversation;
  release(context: Context): Promise<void>;
}
