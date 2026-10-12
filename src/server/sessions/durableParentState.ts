import { copyJson, type Context, type JsonValue } from "@earendil-works/chord";
import { awaitWithContext } from "@earendil-works/chord/context";
import { randomUUID } from "node:crypto";
import { Check } from "typebox/value";
import { Type } from "typebox";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "../../shared/apiTypes.js";
import { ExtensionEntries, Labels, ParentAsks, ParentAsksSchema, ParentResponse, ParentResponseSchema, Presentation, SessionName } from "./durableParentDocuments.js";
import { askAnswerRequestId, createAskDelivery } from "./durableAskDelivery.js";
import { PendingAskValidationError, SessionAsks, renderAskUserAnswersText } from "./sessionAsks.js";
import { ParentAskQuestionSchema, SESSION_RESPONSE_CUSTOM_TYPE, responseAfterEntry, type ResponseProjection, type SessionResponseEvent, SessionResponseEventSchema } from "./sessionResponse.js";
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

/** SDK callbacks queue metadata intents; reads see committed state, never a tentative callback write. */
export function createDurableParentState(
  handle: DurableSessionHandle,
  history: Pick<DurableNativeHistory, "resolve">,
): DurableParentState { return new ParentState(handle, history); }

/** @public Transaction callback supplied to native-fork #45. */
export type InitializeParentDocuments = (tx: Tx, conversation: ConversationRecord) => Promise<void>;

const SubmissionSchema = Type.Object({ answers: Type.Array(Type.Object({ id: Type.String(), values: Type.Array(Type.String()), otherText: Type.Optional(Type.String()) })) });
type MetadataIntent =
  | { kind: "custom"; customType: string; data?: JsonValue; sdkEntryId: string; timestamp: string }
  | { kind: "label"; entryId: string; label?: string }
  | { kind: "name"; name: string };

class ParentState implements DurableParentState {
  private writes: Promise<void> = Promise.resolve();
  private failure: Error | undefined;
  constructor(private readonly handle: DurableSessionHandle, private readonly history: Pick<DurableNativeHistory, "resolve">) {}

  async response(context: Context): Promise<SessionResponse> {
    // The combined read is on Durable's commit line. It cannot join a historical intent to a later live form.
    return this.handle.conversation.commit(async tx => {
      const asks = await tx.doc(ParentAsks, this.handle.conversation.id);
      const response = await tx.doc(ParentResponse, this.handle.conversation.id);
      if (!Check(ParentAsksSchema, asks) || !Check(ParentResponseSchema, response)) throw new Error("Invalid parent response documents");
      if (asks.pending !== undefined) return { kind: "needs-response", reason: "questions" };
      switch (response.intent) {
        case "nothing": return { kind: "none" };
        case "questions": case "reply": return { kind: "needs-response", reason: "reply" };
        case "undeclared": return { kind: "needs-response", reason: "undeclared" };
      }
    }, context);
  }

  async pendingAsk(context: Context): Promise<PendingAskUser | undefined> {
    const asks = await this.handle.harness.snapshot(ParentAsks, this.handle.conversation.id, context);
    if (asks === undefined) throw new Error("Parent ask document is missing");
    if (!Check(ParentAsksSchema, asks)) throw new Error("Invalid parent ask document");
    return asks.pending === undefined ? undefined : structuredClone(asks.pending);
  }

  async declareResponse(awaiting: "nothing" | "reply", context: Context): Promise<void> {
    if (!Check(Type.Union([Type.Literal("nothing"), Type.Literal("reply")]), awaiting)) throw new PendingAskValidationError("Invalid response declaration");
    await this.flush(context);
    await this.handle.conversation.commit(async tx => {
      if ((await tx.doc(ParentAsks, this.handle.conversation.id)).pending !== undefined) throw new PendingAskValidationError("An unanswered ask_user form is already waiting for the user");
      await this.record(tx, { version: 1, kind: "declared", awaiting });
    }, context);
  }

  async openAsk(questions: readonly AskUserQuestion[], context: Context): Promise<PendingAskOpenResult> {
    if (!Check(Type.Array(ParentAskQuestionSchema), questions)) throw new PendingAskValidationError("Invalid question set");
    const input = structuredClone([...questions]);
    await this.flush(context);
    return this.transition(asks => asks.open({ sessionId: this.handle.address.sessionId, questions: input }), context);
  }
  async submitAsk(askId: string, submission: AskUserSubmission, context: Context): Promise<PendingAskCloseResult> {
    const input = Check(SubmissionSchema, submission) ? structuredClone(submission) : submission;
    await this.flush(context);
    // The transition checks staleness before answer validation, as the legacy store does.
    const result = await this.transition<PendingAskCloseResult>(asks => {
      if (asks.pendingAsk(this.handle.address.sessionId)?.askId !== askId) return { status: "stale" };
      if (!Check(SubmissionSchema, input)) throw new PendingAskValidationError("Invalid answer submission");
      return asks.submit(this.handle.address.sessionId, askId, input);
    }, context);
    if (result.status === "closed") this.handle.harness.resume();
    return result;
  }
  async cancelAsk(askId: string, context: Context): Promise<PendingAskCloseResult> {
    await this.flush(context);
    const result = await this.transition(asks => asks.cancel(this.handle.address.sessionId, askId), context);
    if (result.status === "closed") this.handle.harness.resume();
    return result;
  }
  async voidForChatReply(context: Context): Promise<AskUserOutcome | undefined> {
    await this.flush(context);
    return this.transition(asks => asks.voidForChatReply(this.handle.address.sessionId), context);
  }

  appendCustomEntry(customType: string, data: JsonValue | undefined, context: Context): Promise<string> {
    if (typeof customType !== "string" || customType === "") throw new TypeError("Custom entry type must not be empty");
    if (customType === SESSION_RESPONSE_CUSTOM_TYPE && !Check(SessionResponseEventSchema, data)) throw new TypeError("Invalid parent response event");
    const sdkEntryId = randomUUID();
    // Copy before queueing. Mutating an extension's object after the synchronous call must not alter its intent.
    const intent: MetadataIntent = { kind: "custom", customType, sdkEntryId, timestamp: new Date().toISOString(), ...(data === undefined ? {} : { data: copyJson(data) }) };
    const appended = this.enqueue(intent, context).then(() => sdkEntryId);
    // The caller may be a synchronous SDK callback. enqueue retains the failure for flush.
    void appended.catch(() => undefined);
    return appended;
  }
  setLabel(entryId: string, label: string | undefined, context: Context): Promise<void> {
    if (typeof entryId !== "string" || (label !== undefined && typeof label !== "string")) throw new TypeError("Invalid label intent");
    return this.enqueue({ kind: "label", entryId, ...(label === undefined ? {} : { label }) }, context);
  }
  setSessionName(name: string, context: Context): Promise<void> {
    if (typeof name !== "string") throw new TypeError("Invalid session name intent");
    return this.enqueue({ kind: "name", name }, context);
  }
  async flush(context: Context): Promise<void> {
    await awaitWithContext(this.writes, context);
    if (this.failure !== undefined) throw this.failure;
  }

  private enqueue(intent: MetadataIntent, context: Context): Promise<void> {
    const write = this.writes.then(async () => {
      if (this.failure !== undefined) throw this.failure;
      const target = intent.kind === "label" ? await this.history.resolve(intent.entryId, context) : undefined;
      if (target !== undefined && target.journalId !== this.handle.address.journalId) throw new Error("Foreign label target");
      await this.handle.conversation.commit(async tx => {
        const id = this.handle.conversation.id;
        switch (intent.kind) {
          case "custom": {
            if (intent.customType === SESSION_RESPONSE_CUSTOM_TYPE && Check(SessionResponseEventSchema, intent.data)) {
              await this.record(tx, intent.data, intent.sdkEntryId, intent.timestamp);
              break;
            }
            const marker = await tx.appendEntry(id, { kind: "forgerie.app-state", data: { sdkEntryId: intent.sdkEntryId, change: "custom-entry", customType: intent.customType } });
            (await tx.doc(ExtensionEntries, id, intent.customType, null)).entries.push({ id: intent.sdkEntryId, nativeEntryId: marker.id, timestamp: intent.timestamp, ...(intent.data === undefined ? {} : { data: intent.data }) });
            break;
          }
          case "label": {
            if (target === undefined) throw new Error("Missing label target");
            const labels = await tx.doc(Labels, id);
            if (intent.label === undefined) Reflect.deleteProperty(labels.entries, intent.entryId);
            else labels.entries[intent.entryId] = { nativeEntryId: target.entryId, label: intent.label };
            await tx.appendEntry(id, { kind: "forgerie.app-state", data: { sdkEntryId: randomUUID(), change: "label", targetId: intent.entryId } });
            break;
          }
          case "name":
            (await tx.doc(SessionName, id)).name = intent.name;
            await tx.appendEntry(id, { kind: "forgerie.app-state", data: { sdkEntryId: randomUUID(), change: "name" } });
            break;
        }
      }, context);
    });
    // Observe even an unawaited SDK call. Fail the enclosing flush, and do not admit later writes as success.
    this.writes = write.catch((error: unknown) => { this.failure = error instanceof Error ? error : new Error("Durable metadata commit failed", { cause: error }); });
    return write;
  }

  private async transition<T>(action: (asks: SessionAsks) => T, context: Context): Promise<T> {
    return this.handle.conversation.commit(async tx => {
      const id = this.handle.conversation.id;
      const asks = await tx.doc(ParentAsks, id);
      const response = await tx.doc(ParentResponse, id);
      if (!Check(ParentAsksSchema, asks) || !Check(ParentResponseSchema, response)) throw new Error("Invalid parent transition documents");
      const events: SessionResponseEvent[] = [];
      const transitions = new SessionAsks({ readResponse: () => ({ response: { kind: "none" }, ...(asks.pending === undefined ? {} : { pendingAsk: asks.pending }) }), appendEvent: (_sessionId, event) => events.push(event) });
      const result = action(transitions);
      for (const event of events) await this.record(tx, event);
      return result;
    }, context);
  }

  private async record(tx: Tx, event: SessionResponseEvent, sdkEntryId: string = randomUUID(), timestamp = new Date().toISOString()): Promise<void> {
    const id = this.handle.conversation.id;
    const asks = await tx.doc(ParentAsks, id);
    const response = await tx.doc(ParentResponse, id);
    const before: ResponseProjection = { protocol: true, undeclaredRun: response.undeclaredRun,
      response: response.intent === "nothing" ? { kind: "none" } : { kind: "needs-response", reason: response.intent },
      ...(asks.pending === undefined ? {} : { pendingAsk: asks.pending }) };
    const next = responseAfterEntry(before, { type: "custom", customType: SESSION_RESPONSE_CUSTOM_TYPE, data: event });
    response.intent = next.response.kind === "none" ? "nothing" : next.response.reason;
    response.undeclaredRun = next.undeclaredRun === true;
    response.protocol = true;
    if (event.kind === "started") response.missingReplyRetry = "available";
    if (next.pendingAsk === undefined) delete asks.pending; else asks.pending = next.pendingAsk;
    const marker = await tx.appendEntry(id, { kind: "forgerie.app-state", data: { sdkEntryId, change: "custom-entry", customType: SESSION_RESPONSE_CUSTOM_TYPE },
      ...(event.kind === "answered" && event.outcome.reason === "answered-in-chat" ? { model: [{ role: "user" as const, content: renderAskUserAnswersText(event.outcome), timestamp: Date.now() }] } : {}) });
    // This rewindable history is compatibility data, not live form authority. It preserves historical asks on forks.
    (await tx.doc(ExtensionEntries, id, SESSION_RESPONSE_CUSTOM_TYPE, null)).entries.push({ id: sdkEntryId, nativeEntryId: marker.id, timestamp, data: copyJson(event) });
    if (event.kind === "asked" && event.superseded !== undefined) asks.closed[event.superseded.askId] = { outcome: event.superseded, delivery: { kind: "none" } };
    if (event.kind === "answered") {
      const outcome = event.outcome;
      const deliver = outcome.reason === "submitted" || outcome.reason === "cancelled";
      asks.closed[outcome.askId] = { outcome, delivery: deliver ? { kind: "pending", requestId: askAnswerRequestId(outcome.askId) } : { kind: "none" } };
      (await tx.doc(Presentation, id, String(marker.id), null)).envelope = { type: "custom", customType: ASK_USER_ANSWERS_CUSTOM_TYPE, display: true, details: copyJson(outcome) };
      if (deliver) await createAskDelivery(tx, id, outcome.askId);
    }
  }
}
