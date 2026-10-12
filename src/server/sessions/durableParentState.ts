import type { Context, JsonValue } from "@earendil-works/chord";
import type { ConversationRecord, Tx } from "@earendil-works/pi-durable";
import type { AskUserOutcome, AskUserQuestion, AskUserSubmission, PendingAskUser } from "../../shared/apiTypes.js";
import type { SessionResponse } from "../../shared/sessionResponse.js";
import type { PendingAskCloseResult, PendingAskOpenResult } from "./sessionAsks.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";
import type { DurableNativeHistory } from "./durableNativeHistory.js";

export interface DurableParentState {
  response(context: Context): Promise<SessionResponse>;
  pendingAsk(context: Context): Promise<PendingAskUser | undefined>;
  declareResponse(awaiting: "nothing" | "reply", context: Context): Promise<void>;
  voidForChatReply(context: Context): Promise<AskUserOutcome | undefined>;
  openAsk(questions: readonly AskUserQuestion[], context: Context): Promise<PendingAskOpenResult>;
  submitAsk(askId: string, submission: AskUserSubmission, context: Context): Promise<PendingAskCloseResult>;
  cancelAsk(askId: string, context: Context): Promise<PendingAskCloseResult>;
  appendCustomEntry(customType: string, data: JsonValue | undefined, context: Context): Promise<string>;
  setLabel(entryId: string, label: string | undefined, context: Context): Promise<void>;
  setSessionName(name: string, context: Context): Promise<void>;
  flush(context: Context): Promise<void>;
}

/** @public Factory contract implemented by app-state #43. */
export declare function createDurableParentState(
  handle: DurableSessionHandle,
  history: Pick<DurableNativeHistory, "resolve">,
): DurableParentState;

/** @public Transaction callback supplied to native-fork #45. */
export type InitializeParentDocuments = (tx: Tx, conversation: ConversationRecord) => Promise<void>;
