import { Type, type Static } from "typebox";
import { TriggerScheduleSchema } from "./triggerSchedules.js";
import { WorkflowInputsSchema } from "./workflowRuns.js";

/** Trigger IDs become part of workflow request IDs, which allow only letters, digits, and hyphens. */
export const TriggerIdSchema = Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,47}$" });

/** What a fire does. The first slice has one action: start a saved workflow in a new session of a project. */
export const TriggerActionSchema = Type.Object({
  kind: Type.Literal("workflow"),
  cwd: Type.String({ minLength: 1 }),
  workflow: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" }),
  inputs: WorkflowInputsSchema,
}, { additionalProperties: false });
export type TriggerAction = Static<typeof TriggerActionSchema>;

export const TriggerCreateSchema = Type.Object({
  id: TriggerIdSchema,
  name: Type.String({ minLength: 1, maxLength: 120 }),
  schedule: TriggerScheduleSchema,
  action: TriggerActionSchema,
  /** A missed occurrence older than this when the daemon comes back is recorded as missed, not fired late. */
  missedGraceMinutes: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_080 })),
}, { additionalProperties: false });

const FireOutcomeSchema = Type.Union([
  Type.Object({ kind: Type.Literal("started"), sessionId: Type.String(), runId: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("failed"), error: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("missed") }, { additionalProperties: false }),
]);
export const TriggerFireSchema = Type.Object({
  /** The scheduled instant, Unix milliseconds. */
  occurrence: Type.Number(),
  requestId: Type.String(),
  recordedAt: Type.Number(),
  /** Earlier occurrences that passed while the daemon was down and were folded into this one. */
  skippedBefore: Type.Integer({ minimum: 0 }),
  outcome: FireOutcomeSchema,
}, { additionalProperties: false });
export type TriggerFire = Static<typeof TriggerFireSchema>;

export const TriggerStateSchema = Type.Union([
  Type.Object({ kind: Type.Literal("active"), nextFireAt: Type.Number() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("paused"), pausedAt: Type.Number() }, { additionalProperties: false }),
]);

export const TriggerSchema = Type.Object({
  id: TriggerIdSchema,
  name: TriggerCreateSchema.properties.name,
  schedule: TriggerScheduleSchema,
  action: TriggerActionSchema,
  missedGraceMinutes: Type.Integer({ minimum: 0 }),
  createdAt: Type.Number(),
  /**
   * Each arming of the trigger gets a new generation, and its Durable task carries it. Pause, resume, and removal are
   * single commits on this record; a task whose generation is no longer current stops at its next phase.
   */
  generation: Type.Integer({ minimum: 1 }),
  state: TriggerStateSchema,
  /** Newest first, at most TRIGGER_HISTORY_LIMIT entries. */
  history: Type.Array(TriggerFireSchema),
}, { additionalProperties: false });
export type Trigger = Static<typeof TriggerSchema>;

export const DEFAULT_MISSED_GRACE_MINUTES = 360;
export const TRIGGER_HISTORY_LIMIT = 50;

/** One request ID per trigger occurrence. Every downstream receipt keys on it, so a rerun fire starts nothing new. */
export function triggerRequestId(triggerId: string, occurrence: number): string {
  return `trigger-${triggerId}-${String(occurrence)}`;
}
