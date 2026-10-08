import { Check } from "typebox/value";
import { ASK_USER_ANSWERS_CUSTOM_TYPE, type AskUserOutcome } from "../../shared/apiTypes.js";
import { SessionResponseEventSchema, SESSION_RESPONSE_CUSTOM_TYPE } from "./sessionResponse.js";

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
/** Accepted answers are durable before delivery. Reconstruct unfinished delivery after a runtime restart. */
export function undeliveredAskAnswers(entries: readonly unknown[]): AskUserOutcome[] {
  const pending = new Map<string, AskUserOutcome>();
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (entry["type"] === "custom" && entry["customType"] === SESSION_RESPONSE_CUSTOM_TYPE && Check(SessionResponseEventSchema, entry["data"]) && entry["data"].kind === "answered") {
      const { outcome } = entry["data"];
      if (outcome.reason === "submitted" || outcome.reason === "cancelled") pending.set(outcome.askId, outcome);
    }
    if (entry["type"] === "custom_message" && entry["customType"] === ASK_USER_ANSWERS_CUSTOM_TYPE && isRecord(entry["details"])) {
      const id = entry["details"]["askId"];
      if (typeof id === "string") pending.delete(id);
    }
  }
  return [...pending.values()];
}
