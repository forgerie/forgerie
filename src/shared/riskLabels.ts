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
export const RiskLabelEntrySchema = Type.Object({
  target: Type.Union([Type.Literal("gate"), Type.Literal("tool")]), id: Type.String({ minLength: 1 }), label: RiskLabelSchema,
}, { additionalProperties: false });
export type RiskLabelEntry = Static<typeof RiskLabelEntrySchema>;
