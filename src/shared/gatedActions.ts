import { Type, type Static } from "typebox";
import { RiskLabelSchema } from "./riskLabels.js";
import { GatedCategorySchema } from "./autonomyPolicy.js";

export const GatedActionStateSchema = Type.Union([
  Type.Object({ kind: Type.Literal("waiting") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("approved") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("refused") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("ran"), result: Type.Unknown(), at: Type.Number() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("failed"), error: Type.String(), at: Type.Number() }, { additionalProperties: false }),
]);
export const GatedActionSchema = Type.Object({
  id: Type.String(), conversationId: Type.Integer({ minimum: 1 }), by: Type.String(), tool: Type.String(),
  args: Type.Record(Type.String(), Type.Unknown()), category: GatedCategorySchema, description: Type.String(),
  riskLabel: Type.Optional(RiskLabelSchema),
  requestedAt: Type.Number(), state: GatedActionStateSchema,
}, { additionalProperties: false });
export type GatedAction = Omit<Static<typeof GatedActionSchema>, "state"> & {state: GatedActionState};
export type GatedActionState = Static<typeof GatedActionStateSchema>;
export const GatedActionRequestSchema = Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false });
export const GATED_ACTION_ENTRY_KIND = "forgerie.gated-action";
export const GatedActionEntrySchema = Type.Object({
  id: Type.String(), by: Type.String(), tool: Type.String(), category: GatedCategorySchema,
  description: Type.String(), command: Type.String(), riskLabel: Type.Optional(RiskLabelSchema),
}, { additionalProperties: false });
export type GatedActionEntry = Static<typeof GatedActionEntrySchema>;
