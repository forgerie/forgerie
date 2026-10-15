import { Type, type Static } from "typebox";

/** Gateway opinions, not permission to approve or execute. Noul values are in [0, 1]. */
export const RiskLabelSchema = Type.Object({
  model: Type.String({ minLength: 1 }),
  deletes_data: Type.Number({ minimum: 0, maximum: 1 }),
  outside_worktree: Type.Number({ minimum: 0, maximum: 1 }),
  acts_as_user: Type.Number({ minimum: 0, maximum: 1 }),
  risk: Type.Union([Type.Literal("low"), Type.Literal("check"), Type.Literal("danger")]),
  risk_score: Type.Number({ minimum: 0, maximum: 2 }),
}, { additionalProperties: false });
export type RiskLabel = Static<typeof RiskLabelSchema>;
export const RISK_LABEL_ENTRY_KIND = "forgerie.risk-label";
export const RiskLabelEntrySchema = Type.Union([
  Type.Object({target: Type.Literal("gate"), id: Type.String({minLength: 1}), label: RiskLabelSchema}, {additionalProperties: false}),
  Type.Object({target: Type.Literal("tool"), id: Type.String({minLength: 1}), invocationId: Type.String({minLength: 1}),
    sourceInvocationId: Type.String({minLength: 1}), label: RiskLabelSchema}, {additionalProperties: false}),
]);
export type RiskLabelEntry = Static<typeof RiskLabelEntrySchema>;
export type RiskToolIdentity = Pick<Extract<RiskLabelEntry, {target: "tool"}>, "invocationId" | "sourceInvocationId">;

/** A source entry and call identify one invocation across turns, replays and sibling conversations.
 * The ordinal distinguishes nested SDK calls without changing model-generated ids.
 */
export function riskToolIdentity(conversation: number, assistant: number, callId: string, ordinal = 0): RiskToolIdentity {
  return {invocationId: JSON.stringify([conversation, assistant, callId, ordinal]), sourceInvocationId: JSON.stringify([conversation, assistant, callId, 0])};
}
