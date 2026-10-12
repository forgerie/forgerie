import { Check } from "typebox/value";
import { Type } from "typebox";
import { ASK_USER_ANSWERS_CUSTOM_TYPE, type AskUserOutcome, type PendingAskUser } from "../../shared/apiTypes.js";
import { SessionResponseSchema, type SessionResponse } from "../../shared/sessionResponse.js";

export const SESSION_RESPONSE_CUSTOM_TYPE = "forgerie.session-response.v1";
export type SessionResponseEvent =
  | { version: 1; kind: "started" }
  | { version: 1; kind: "declared"; awaiting: "nothing" | "reply" }
  | { version: 1; kind: "asked"; ask: PendingAskUser; superseded?: AskUserOutcome }
  | { version: 1; kind: "answered"; outcome: AskUserOutcome };

export interface ResponseProjection {
  response: SessionResponse;
  protocol?: true;
  undeclaredRun?: boolean;
  pendingAsk?: PendingAskUser;
}
export const EMPTY_RESPONSE: ResponseProjection = { response: { kind: "none" } };
const Option = Type.Object({ value: Type.String(), label: Type.String(), detail: Type.Optional(Type.String()) });
const Question = Type.Object({ id: Type.String(), question: Type.String(), detail: Type.Optional(Type.String()), options: Type.Array(Option), multiple: Type.Optional(Type.Boolean()) });
const Ask = Type.Object({ askId: Type.String(), askedAt: Type.String(), questions: Type.Array(Question, { minItems: 1 }) });
const Outcome = Type.Object({
  askId: Type.String(), reason: Type.Union([Type.Literal("submitted"), Type.Literal("cancelled"), Type.Literal("superseded"), Type.Literal("answered-in-chat")]),
  askedAt: Type.String(), closedAt: Type.String(),
  questions: Type.Array(Type.Object({ question: Question, answered: Type.Boolean(), values: Type.Array(Type.String()), otherText: Type.Optional(Type.String()) })),
  answeredCount: Type.Number(), unansweredIds: Type.Array(Type.String()), summary: Type.String(),
});
export const SessionResponseEventSchema = Type.Union([
  Type.Object({ version: Type.Literal(1), kind: Type.Literal("started") }),
  Type.Object({ version: Type.Literal(1), kind: Type.Literal("declared"), awaiting: Type.Union([Type.Literal("nothing"), Type.Literal("reply")]) }),
  Type.Object({ version: Type.Literal(1), kind: Type.Literal("asked"), ask: Ask, superseded: Type.Optional(Outcome) }),
  Type.Object({ version: Type.Literal(1), kind: Type.Literal("answered"), outcome: Outcome }),
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/** Fold the active branch, including entries before compaction. Not the LLM's trimmed messages. */
export function responseFromBranch(entries: readonly unknown[]): ResponseProjection {
  return entries.reduce<ResponseProjection>(responseAfterEntry, EMPTY_RESPONSE);
}

export function responseAfterEntry(current: ResponseProjection, raw: unknown): ResponseProjection {
  const entry = record(raw);
  if (entry === undefined) return current;
  if (entry["type"] === "custom" && entry["customType"] === SESSION_RESPONSE_CUSTOM_TYPE) {
    const event = entry["data"];
    if (record(event)?.["kind"] === "checkpoint") return current;
    if (!Check(SessionResponseEventSchema, event)) throw new Error("Invalid durable session response event");
    current = { ...current, protocol: true };
    switch (event.kind) {
      case "started": return { ...current, undeclaredRun: true, response: { kind: "needs-response", reason: current.pendingAsk === undefined ? "undeclared" : "questions" } };
      case "declared": return { ...current, undeclaredRun: false, response: event.awaiting === "reply" ? { kind: "needs-response", reason: "reply" } : { kind: "none" } };
      case "asked": return { protocol: true, undeclaredRun: false, response: { kind: "needs-response", reason: "questions" }, pendingAsk: event.ask };
      case "answered":
        if (current.pendingAsk?.askId !== event.outcome.askId) return current;
        return { protocol: true, response: event.outcome.reason === "answered-in-chat" ? { kind: "needs-response", reason: "reply" } : { kind: "none" } };
    }
  }
  if (entry["type"] === "message") {
    const message = record(entry["message"]);
    // Only delivered user messages acknowledge a request. Queueing does not.
    if (message?.["role"] === "user") return { ...EMPTY_RESPONSE, ...(current.protocol === true ? { protocol: true } : {}), ...(current.undeclaredRun === true ? { undeclaredRun: true } : {}) };
    if (message?.["role"] === "assistant" && current.undeclaredRun === true && message["stopReason"] !== "toolUse" && message["stopReason"] !== "pending") {
      return { ...current, undeclaredRun: false, response: { kind: "needs-response", reason: current.pendingAsk === undefined ? "undeclared" : "questions" } };
    }
    // Recover older successful asks from their recorded results. Never trust an attempted/failed call.
    if (message?.["role"] === "toolResult" && message["toolName"] === "ask_user" && message["isError"] !== true) {
      if (current.protocol === true) return current;
      const details = record(message["details"]);
      const ask = details?.["ask"];
      if (Check(Ask, ask)) return { response: { kind: "needs-response", reason: "questions" }, pendingAsk: ask };
    }
  }
  if (entry["type"] === "custom_message" && entry["customType"] === ASK_USER_ANSWERS_CUSTOM_TYPE) {
    const details = record(entry["details"]);
    if (details?.["reason"] !== "answered-in-chat" && details?.["askId"] === current.pendingAsk?.askId && current.pendingAsk !== undefined) return { ...EMPTY_RESPONSE, ...(current.protocol === true ? { protocol: true } : {}) };
  }
  return current;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** The content of the assistant message that made the current call. Direct tool unit tests can have none. */
function callingAssistantContent(entries: readonly unknown[]): unknown[] | undefined {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const message = record(record(entries[i])?.["message"]);
    const content: unknown = message?.["content"];
    if (message?.["role"] === "assistant" && isUnknownArray(content)) return content;
  }
  return undefined;
}

/** A terminal declaration cannot share a batch with work that can keep the run alive. */
export function assertTerminalToolAlone(entries: readonly unknown[], toolCallId: string): void {
  const content = callingAssistantContent(entries);
  if (content === undefined) return;
  const calls = content.map(record).filter((part) => part?.["type"] === "toolCall");
  if (calls.length !== 1 || calls[0]?.["id"] !== toolCallId) throw new Error("Call this turn-ending tool alone, after all other tools finish.");
}

/** Every refusal text, current and earlier, starts with this, so older transcripts keep their spent retry. */
const MISSING_REPLY_PREFIX = "The user sees no reply:";
/**
 * The retry asks for text only. A model that left its answer in thinking once
 * tends to repeat that while it still owes a tool call, so the retry removes
 * the tool call: its text reply ends the run without a declaration.
 */
const MISSING_REPLY_ERROR = `${MISSING_REPLY_PREFIX} this message has no text, and thinking is not shown. Do not call end_turn again. Reply now with your full answer as plain text and call no tool. That text ends the run.`;

/** Recovery is derived from the active transcript, so restart and branch navigation cannot reset it. */
export function previousToolRefusedReply(entries: readonly unknown[], toolName: string): boolean {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = record(entries[i]);
    // Protocol boundaries reset recovery; checkpoints only cache response state.
    if (entry?.["type"] === "custom" && entry["customType"] === SESSION_RESPONSE_CUSTOM_TYPE
      && record(entry["data"])?.["kind"] !== "checkpoint") return false;
    const message = record(entry?.["message"]);
    if (message?.["role"] === "user") return false;
    if (message?.["role"] !== "toolResult") continue;
    const content = message["content"];
    return message["toolName"] === toolName && message["isError"] === true && isUnknownArray(content)
      && content.some((part) => { const text = record(part)?.["text"]; return typeof text === "string" && text.startsWith(MISSING_REPLY_PREFIX); });
  }
  return false;
}

/**
 * A declaration ends the run, so the reply must already be visible text in the
 * same message. Thinking is never shown, and text in an earlier message of the
 * run came before tool calls, so it is narration, not the reply.
 */
export function assertReplyWritten(entries: readonly unknown[]): void {
  const content = callingAssistantContent(entries);
  if (content === undefined) return;
  const written = content.some((part) => {
    const block = record(part);
    return block?.["type"] === "text" && typeof block["text"] === "string" && block["text"].trim() !== "";
  });
  if (!written) throw new Error(MISSING_REPLY_ERROR);
}

/** Compact, reconstructible catalog projection stored in the same session log at settlement. */
export function responseCheckpoint(entry: Record<string, unknown>): SessionResponse | undefined {
  if (entry["type"] !== "custom" || entry["customType"] !== SESSION_RESPONSE_CUSTOM_TYPE) return undefined;
  const data = record(entry["data"]);
  if (data?.["version"] !== 1 || data["kind"] !== "checkpoint") return undefined;
  const response = data["response"];
  if (!Check(SessionResponseSchema, response)) throw new Error("Invalid response checkpoint");
  return response;
}
