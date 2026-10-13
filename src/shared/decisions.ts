import { Type, type Static } from "typebox";

export const DecisionKindSchema = Type.Union([Type.Literal("child-answer"), Type.Literal("guess"), Type.Literal("gated"), Type.Literal("auto-stop"), Type.Literal("issue")]);
export const DecisionStateSchema = Type.Union([
  Type.Object({ kind: Type.Literal("standing") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("overturned"), note: Type.String(), at: Type.Number() }, { additionalProperties: false }),
]);
export const DecisionSchema = Type.Object({
  id: Type.String(), at: Type.Number(), kind: DecisionKindSchema, by: Type.String(), runId: Type.Optional(Type.String()),
  question: Type.String(), choice: Type.String(), reason: Type.String(), flagged: Type.Boolean(), state: DecisionStateSchema,
}, { additionalProperties: false });
export type Decision = Static<typeof DecisionSchema>;
export const DecisionOverturnSchema = Type.Object({ cwd: Type.String({ minLength: 1 }), note: Type.String({ minLength: 1, maxLength: 8000 }) }, { additionalProperties: false });
export const RecordDecisionSchema = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 65536 }), choice: Type.String({ minLength: 1, maxLength: 65536 }),
  reason: Type.String({ minLength: 1, maxLength: 65536 }), guess: Type.Boolean(),
}, { additionalProperties: false });
