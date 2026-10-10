import { Type, type Static } from "typebox";

export const WORKFLOW_RETENTION_DAYS = 90;
export const WorkflowValueSchema = Type.Union([Type.String({ maxLength: 65536 }), Type.Boolean(), Type.Number()]);
export const WorkflowInputsSchema = Type.Record(Type.String({ pattern: "^[a-z][a-zA-Z0-9_]*$" }), WorkflowValueSchema);
export const WorkflowInputSchema = Type.Object({
  type: Type.Union([Type.Literal("string"), Type.Literal("boolean"), Type.Literal("number")]),
  description: Type.Optional(Type.String()),
  choices: Type.Optional(Type.Array(WorkflowValueSchema, { minItems: 1 })),
  default: Type.Optional(WorkflowValueSchema),
}, { additionalProperties: false });
export const WorkflowDefinitionSchema = Type.Object({ version: Type.Literal(1), inputs: Type.Optional(Type.Record(Type.String({ pattern: "^[a-z][a-zA-Z0-9_]*$" }), WorkflowInputSchema)) }, { additionalProperties: false });
export type WorkflowInputs = Static<typeof WorkflowInputsSchema>;
export type WorkflowDefinition = Static<typeof WorkflowDefinitionSchema>;
export const WorkflowOutcomeSchema = Type.Union([Type.Literal("completed"), Type.Literal("failed"), Type.Literal("stopped")]);
export type WorkflowOutcome = Static<typeof WorkflowOutcomeSchema>;
export const WorkflowRunSchema = Type.Object({
  id: Type.String(), requestId: Type.String(), startedAt: Type.Number(),
  session: Type.Object({ id: Type.String(), cwd: Type.String() }),
  definition: Type.Object({ name: Type.String(), path: Type.String(), sha256: Type.String(), text: Type.String() }),
  inputs: WorkflowInputsSchema,
  state: Type.Union([
    Type.Object({ kind: Type.Literal("running") }),
    Type.Object({ kind: Type.Literal("finished"), outcome: WorkflowOutcomeSchema, result: Type.String(), finishedAt: Type.Number() }),
  ]),
  children: Type.Array(Type.Object({ conversationId: Type.Number(), reporterId: Type.Number(), name: Type.String(),
    state: Type.Union([
      Type.Object({ kind: Type.Literal("working") }),
      Type.Object({ kind: Type.Literal("settled"), outcome: Type.Union([Type.Literal("answered"), Type.Literal("failed"), Type.Literal("stopped")]), result: Type.String(), delivered: Type.Boolean(), deliveryError: Type.Optional(Type.String()) }),
    ]),
  })),
});
export type WorkflowRun = Static<typeof WorkflowRunSchema>;
export const WorkflowLaunchSchema = Type.Object({ cwd: Type.String({ minLength: 1 }), name: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" }),
  inputs: WorkflowInputsSchema, requestId: Type.String({ pattern: "^[a-zA-Z0-9-]{1,128}$" }) }, { additionalProperties: false });
export const WorkflowFinishSchema = Type.Object({ cwd: Type.String({ minLength: 1 }), outcome: WorkflowOutcomeSchema,
  result: Type.String({ minLength: 1, maxLength: 65536 }) }, { additionalProperties: false });
