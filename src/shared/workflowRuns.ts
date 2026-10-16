import { Type, type Static } from "typebox";
import { KNOWN_THINKING_LEVELS } from "./thinkingLevels.js";

export const WORKFLOW_RETENTION_DAYS = 90;
export const WorkflowValueSchema = Type.Union([Type.String({ maxLength: 65536 }), Type.Boolean(), Type.Number()]);
export const WorkflowInputsSchema = Type.Record(Type.String({ pattern: "^[a-z][a-zA-Z0-9_]*$" }), WorkflowValueSchema);
export const WorkflowInputSchema = Type.Object({
  type: Type.Union([Type.Literal("string"), Type.Literal("boolean"), Type.Literal("number")]),
  description: Type.Optional(Type.String()),
  choices: Type.Optional(Type.Array(WorkflowValueSchema, { minItems: 1 })),
  default: Type.Optional(WorkflowValueSchema),
}, { additionalProperties: false });
/** Wire format for a worker model override. Null restores the default: the agent file's model, else the session's. */
export const WorkflowModelSchema = Type.Union([Type.String({ minLength: 1, maxLength: 128,
  pattern: `^[^\\s/:]+/[^\\s/:]+(?:/[^\\s/:]+)*(?::(?:${KNOWN_THINKING_LEVELS.join("|")}))?$` }), Type.Null()]);
export const WorkflowModelsSchema = Type.Record(Type.String({ pattern: "^[a-z][a-z0-9-]{0,31}$" }), WorkflowModelSchema);
export type WorkflowModels = Static<typeof WorkflowModelsSchema>;
/** A worker the stage expects. The agent decides how and when to start it. */
export const WorkflowWorkerSchema = Type.Object({
  name: Type.String({ pattern: "^[a-z][a-z0-9-]{0,31}$" }),
  agent: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  model: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()])),
}, { additionalProperties: false });
/**
 * One stage of the route. A stage with `stop` names the user: Forgerie holds the run there until the user decides.
 * `approve` asks for approval of what the agent prepared; `land` lands the run's child branches.
 */
export const WorkflowStageSchema = Type.Object({
  id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,31}$" }),
  name: Type.String({ minLength: 1, maxLength: 80 }),
  does: Type.Optional(Type.String({ maxLength: 400 })),
  stop: Type.Optional(Type.Union([Type.Literal("approve"), Type.Literal("land")])),
  workers: Type.Optional(Type.Array(WorkflowWorkerSchema, { minItems: 1, maxItems: 8 })),
}, { additionalProperties: false });
export type WorkflowStage = Static<typeof WorkflowStageSchema>;
export const WorkflowDefinitionSchema = Type.Object({
  version: Type.Literal(1),
  inputs: Type.Optional(Type.Record(Type.String({ pattern: "^[a-z][a-zA-Z0-9_]*$" }), WorkflowInputSchema)),
  stages: Type.Optional(Type.Array(WorkflowStageSchema, { minItems: 1, maxItems: 20 })),
}, { additionalProperties: false });
export type WorkflowInputs = Static<typeof WorkflowInputsSchema>;
export type WorkflowDefinition = Static<typeof WorkflowDefinitionSchema>;
export const WorkflowOutcomeSchema = Type.Union([Type.Literal("completed"), Type.Literal("failed"), Type.Literal("stopped")]);
export type WorkflowOutcome = Static<typeof WorkflowOutcomeSchema>;
/**
 * open: the agent has not asked yet, or the user asked for changes (note).
 * waiting: the agent asked; the run holds here until the user decides.
 * approved: the user approved or landed; later stages may start.
 */
export const WorkflowStopStateSchema = Type.Object({
  state: Type.Union([Type.Literal("open"), Type.Literal("waiting"), Type.Literal("approved")]),
  summary: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
  requestedAt: Type.Optional(Type.Number()),
  decidedAt: Type.Optional(Type.Number()),
  /** Branches Forgerie landed at a land stop, in landing order. */
  landed: Type.Optional(Type.Array(Type.String())),
  /** Counts decisions, so each delivery to the agent has its own receipt. */
  round: Type.Optional(Type.Integer({ minimum: 0 })),
  /** Who passed the stop. Absent: the user. `forgerie`: the Workflow autonomy setting passed it. */
  decidedBy: Type.Optional(Type.Literal("forgerie")),
}, { additionalProperties: false });
export type WorkflowStopState = Static<typeof WorkflowStopStateSchema>;
/** Suppression is a delivery state, not a delivery error. Old false flags remain false. */
export const WorkflowChildDeliverySchema = Type.Union([Type.Boolean(), Type.Literal("duplicate"), Type.Literal("aborted")]);
export type WorkflowChildDelivery = Static<typeof WorkflowChildDeliverySchema>;
/**
 * The run sat idle after a child failed. woken: Forgerie told the agent once. flagged: nothing ran after that, so the
 * run waits for the user. A new child, a stop request, the user's next message, or the end of the run clears it.
 */
const WorkflowStallSchema = Type.Object({
  state: Type.Union([Type.Literal("woken"), Type.Literal("flagged")]),
  child: Type.String(), error: Type.String(), at: Type.Number(),
}, { additionalProperties: false });
export const WorkflowRunSchema = Type.Object({
  id: Type.String(), requestId: Type.String(), startedAt: Type.Number(),
  session: Type.Object({ id: Type.String(), cwd: Type.String() }),
  definition: Type.Object({ name: Type.String(), path: Type.String(), sha256: Type.String(), text: Type.String() }),
  inputs: WorkflowInputsSchema,
  state: Type.Union([
    Type.Object({ kind: Type.Literal("running") }),
    Type.Object({ kind: Type.Literal("stopping") }),
    Type.Object({ kind: Type.Literal("finished"), outcome: WorkflowOutcomeSchema, result: Type.String(), finishedAt: Type.Number() }),
  ]),
  /** The launch route with the user's current worker model overrides. Absent on runs launched before stages existed. */
  stages: Type.Optional(Type.Array(WorkflowStageSchema)),
  /** One entry per stop stage, keyed by stage id. */
  stops: Type.Optional(Type.Record(Type.String(), WorkflowStopStateSchema)),
  stall: Type.Optional(WorkflowStallSchema),
  /** Review rounds allowed per reviewer, from Workflow autonomy at launch. Absent: no limit. */
  reviewRounds: Type.Optional(Type.Integer({ minimum: 1 })),
  children: Type.Array(Type.Object({ conversationId: Type.Number(), reporterId: Type.Number(), name: Type.String(),
    /** The stage this child request belongs to, when the run has stages. */
    stage: Type.Optional(Type.String()),
    state: Type.Union([
      Type.Object({ kind: Type.Literal("working") }),
      Type.Object({ kind: Type.Literal("settled"), outcome: Type.Union([Type.Literal("answered"), Type.Literal("failed"), Type.Literal("stopped")]), result: Type.String(), delivered: WorkflowChildDeliverySchema, deliveryError: Type.Optional(Type.String()) }),
    ]),
  })),
});
export type WorkflowRun = Static<typeof WorkflowRunSchema>;
export const WorkflowLaunchSchema = Type.Object({ cwd: Type.String({ minLength: 1 }), name: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" }),
  inputs: WorkflowInputsSchema, models: Type.Optional(WorkflowModelsSchema), requestId: Type.String({ pattern: "^[a-zA-Z0-9-]{1,128}$" }) }, { additionalProperties: false });
export const WorkflowStopDecisionSchema = Type.Object({ cwd: Type.String({ minLength: 1 }),
  decision: Type.Union([Type.Literal("approve"), Type.Literal("changes"), Type.Literal("land")]),
  note: Type.Optional(Type.String({ maxLength: 8000 })) }, { additionalProperties: false });
export type WorkflowStopDecision = Static<typeof WorkflowStopDecisionSchema>["decision"];
export const WorkflowFinishSchema = Type.Object({ cwd: Type.String({ minLength: 1 }), outcome: WorkflowOutcomeSchema,
  result: Type.String({ minLength: 1, maxLength: 65536 }) }, { additionalProperties: false });

export const WorkflowCancelSchema = Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false });

export const WorkflowWorkerModelSchema = Type.Object({ cwd: Type.String({ minLength: 1 }), model: WorkflowModelSchema }, { additionalProperties: false });
