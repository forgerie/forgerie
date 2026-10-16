import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { Check } from "typebox/value";

const Reply = Type.Object({ text: Type.String({ minLength: 1 }), timestamp: Type.Number() });

/** Display-only answer, committed with the declaration. Never copy thinking or add a model generation/usage. */
export function endTurnReplyMessage(entry: EntryRecord): AssistantMessage | undefined {
  if (entry.kind !== "forgerie.app-state" || typeof entry.data !== "object" || entry.data === null || Array.isArray(entry.data) || entry.data["endTurnReply"] === undefined) return undefined;
  const reply = entry.data["endTurnReply"];
  if (!Check(Reply, reply) || reply.text.trim() === "") throw new Error("Invalid committed end_turn reply");
  // SDK JSONL requires assistant metadata. This is presentation, not provider work; accounting stays in pi.usage.
  return { role: "assistant", content: [{ type: "text", text: reply.text }], timestamp: reply.timestamp,
    api: "forgerie", provider: "forgerie", model: "end_turn", stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
