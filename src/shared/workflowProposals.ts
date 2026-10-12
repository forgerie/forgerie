import { Type, type Static } from "typebox";
import { WorkflowDefinitionSchema, WorkflowInputsSchema } from "./workflowRuns.js";

export const WorkflowProposalStateSchema = Type.Union([
  Type.Object({ kind: Type.Literal("open") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("started"), runId: Type.String(), decidedAt: Type.Number() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("changes"), note: Type.String(), decidedAt: Type.Number() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("dismissed"), decidedAt: Type.Number() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("replaced"), by: Type.String(), decidedAt: Type.Number() }, { additionalProperties: false }),
]);
export const WorkflowProposalSchema = Type.Object({
  id: Type.String(),
  name: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" }),
  summary: Type.String({ minLength: 1, maxLength: 280 }),
  text: Type.String({ minLength: 1 }),
  sha256: Type.String(),
  createdAt: Type.Number(),
  definition: WorkflowDefinitionSchema,
  inputs: WorkflowInputsSchema,
  state: WorkflowProposalStateSchema,
}, { additionalProperties: false });
export type WorkflowProposal = Static<typeof WorkflowProposalSchema>;
export const WorkflowProposalToolSchema = Type.Object({
  name: WorkflowProposalSchema.properties.name,
  summary: WorkflowProposalSchema.properties.summary,
  text: WorkflowProposalSchema.properties.text,
  inputs: Type.Optional(WorkflowInputsSchema),
}, { additionalProperties: false });
export type WorkflowProposalTool = Static<typeof WorkflowProposalToolSchema>;
export const WorkflowProposalStartSchema = Type.Object({
  cwd: Type.String({ minLength: 1 }), inputs: WorkflowInputsSchema,
  requestId: Type.String({ pattern: "^[a-zA-Z0-9-]{1,128}$" }),
}, { additionalProperties: false });
export const WorkflowProposalChangesSchema = Type.Object({
  cwd: Type.String({ minLength: 1 }), note: Type.String({ minLength: 1, maxLength: 8000 }),
}, { additionalProperties: false });
export const WorkflowProposalDismissSchema = Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false });
