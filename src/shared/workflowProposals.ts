import { Type, type Static } from "typebox";
import { WorkflowDefinitionSchema, WorkflowInputsSchema, WorkflowModelsSchema } from "./workflowRuns.js";

export const WorkflowProposalStateSchema = Type.Union([
  Type.Object({ kind: Type.Literal("open") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("started"), runId: Type.String(), decidedAt: Type.Number() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("changes"), note: Type.String(), decidedAt: Type.Number() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("dismissed"), decidedAt: Type.Number() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("replaced"), by: Type.String(), decidedAt: Type.Number() }, { additionalProperties: false }),
  /** The user chose to have the agent follow the plan itself, in this session, without child agents. */
  Type.Object({ kind: Type.Literal("here"), decidedAt: Type.Number() }, { additionalProperties: false }),
]);
/** Where a proposal comes from: a saved workflow it adapts, or a new plan because no saved workflow fits. */
export const WorkflowProposalBasisSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("saved"),
    name: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$", description: "The saved workflow this plan adapts." }),
    changes: Type.String({ minLength: 1, maxLength: 1000, description: "What this plan changes from the saved workflow, and why. Write None if it only adds this task's instructions." }),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("new"),
    reason: Type.String({ minLength: 1, maxLength: 1000, description: "Which saved workflows you considered, and why none fits." }),
  }, { additionalProperties: false }),
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
  /** Absent on proposals made before the agent had to consider saved workflows. */
  basis: Type.Optional(WorkflowProposalBasisSchema),
}, { additionalProperties: false });
export type WorkflowProposal = Static<typeof WorkflowProposalSchema>;
export const WorkflowProposalToolSchema = Type.Object({
  name: WorkflowProposalSchema.properties.name,
  summary: WorkflowProposalSchema.properties.summary,
  text: WorkflowProposalSchema.properties.text,
  inputs: Type.Optional(WorkflowInputsSchema),
  basis: WorkflowProposalBasisSchema,
}, { additionalProperties: false });
export type WorkflowProposalTool = Static<typeof WorkflowProposalToolSchema>;
export const WorkflowProposalStartSchema = Type.Object({
  cwd: Type.String({ minLength: 1 }), inputs: WorkflowInputsSchema, models: Type.Optional(WorkflowModelsSchema),
  requestId: Type.String({ pattern: "^[a-zA-Z0-9-]{1,128}$" }),
}, { additionalProperties: false });
export const WorkflowProposalChangesSchema = Type.Object({
  cwd: Type.String({ minLength: 1 }), note: Type.String({ minLength: 1, maxLength: 8000 }),
}, { additionalProperties: false });
export const WorkflowProposalDismissSchema = Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false });
export const WorkflowProposalHereSchema = Type.Object({ cwd: Type.String({ minLength: 1 }), inputs: WorkflowInputsSchema }, { additionalProperties: false });
