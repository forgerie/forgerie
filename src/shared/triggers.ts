import { Type, type Static } from "typebox";
import { KNOWN_THINKING_LEVELS } from "./thinkingLevels.js";
import { TriggerScheduleSchema } from "./triggerSchedules.js";
import { WorkflowInputSchema, WorkflowInputsSchema } from "./workflowRuns.js";

/** Trigger IDs become part of workflow request IDs, which allow only letters, digits, and hyphens. */
export const TriggerIdSchema = Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,47}$" });

/** What a fire does. The first slice has one action: start a saved workflow in a new session of a project. */
export const TriggerActionSchema = Type.Object({
  kind: Type.Literal("workflow"),
  cwd: Type.String({ minLength: 1 }),
  workflow: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" }),
  inputs: WorkflowInputsSchema,
  /** Strict `provider/model-id`, the same form as `POST /sessions` `modelSpec`. Absent: the new-session default. */
  model: Type.Optional(Type.String({ minLength: 3, maxLength: 128, pattern: "^[^/\\s]+/\\S+$" })),
  thinkingLevel: Type.Optional(Type.Union(KNOWN_THINKING_LEVELS.map((level) => Type.Literal(level)))),
}, { additionalProperties: false });
export type TriggerAction = Static<typeof TriggerActionSchema>;

/** Who made the trigger. The server sets it: routes record the user, the agent tool records the calling session. */
export const TriggerCreatorSchema = Type.Union([
  Type.Object({ kind: Type.Literal("user") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("agent"), sessionId: Type.String({ minLength: 1 }), cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
]);
export type TriggerCreator = Static<typeof TriggerCreatorSchema>;

const MissedGraceSchema = Type.Integer({ minimum: 0, maximum: 10_080 });

export const TriggerCreateSchema = Type.Object({
  /** Optional. Without it the server derives one from `name`, adding a numeric suffix when the slug is taken. */
  id: Type.Optional(TriggerIdSchema),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  schedule: TriggerScheduleSchema,
  action: TriggerActionSchema,
  /** A missed occurrence older than this when the daemon comes back is recorded as missed, not fired late. */
  missedGraceMinutes: Type.Optional(MissedGraceSchema),
}, { additionalProperties: false });
export type TriggerCreate = Static<typeof TriggerCreateSchema>;

/** A partial edit. `baseRevision` must equal the stored `revision`, or the edit is refused with 409. */
export const TriggerUpdateSchema = Type.Object({
  baseRevision: Type.Integer({ minimum: 1 }),
  name: Type.Optional(TriggerCreateSchema.properties.name),
  schedule: Type.Optional(TriggerScheduleSchema),
  action: Type.Optional(TriggerActionSchema),
  missedGraceMinutes: Type.Optional(MissedGraceSchema),
}, { additionalProperties: false });
export type TriggerUpdate = Static<typeof TriggerUpdateSchema>;

const FireOutcomeSchema = Type.Union([
  /** Written when a fire starts and replaced when it ends, so a reload still shows the fire in progress. */
  Type.Object({ kind: Type.Literal("running"), startedAt: Type.Number() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("started"), sessionId: Type.String(), cwd: Type.String(), runId: Type.String() }, { additionalProperties: false }),
  /** `sessionId` and `cwd` are present when the session was created before the failure. */
  Type.Object({ kind: Type.Literal("failed"), error: Type.String(), sessionId: Type.Optional(Type.String()), cwd: Type.Optional(Type.String()) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("missed") }, { additionalProperties: false }),
]);
export const TriggerFireSchema = Type.Object({
  /** The scheduled instant for `schedule` fires; the request time for `manual` fires. Unix milliseconds. */
  occurrence: Type.Number(),
  requestId: Type.String(),
  cause: Type.Union([Type.Literal("schedule"), Type.Literal("manual")]),
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
  createdBy: TriggerCreatorSchema,
  /** Starts at 1 and increases with every user-visible change: edit, pause, resume, acknowledge, or a recorded fire. */
  revision: Type.Integer({ minimum: 1 }),
  /**
   * Each arming of the trigger gets a new generation, and its Durable task carries it. Pause, resume, and removal are
   * single commits on this record; a task whose generation is no longer current stops at its next phase.
   */
  generation: Type.Integer({ minimum: 1 }),
  state: TriggerStateSchema,
  /** Set by the first failed or missed fire after the last acknowledgement. Cleared only by the acknowledge route. */
  attention: Type.Union([Type.Object({ since: Type.Number() }, { additionalProperties: false }), Type.Null()]),
  /** Newest first. At most TRIGGER_HISTORY_LIMIT in storage and from GET /triggers/:id; TRIGGER_LIST_HISTORY from GET /triggers. */
  history: Type.Array(TriggerFireSchema),
}, { additionalProperties: false });
export type Trigger = Static<typeof TriggerSchema>;

export const TriggerListResponseSchema = Type.Object({
  triggers: Type.Array(TriggerSchema),
  /** The number of triggers whose `attention` is set. */
  attentionCount: Type.Integer({ minimum: 0 }),
  /** The daemon host's IANA zone: the default for a new schedule. */
  timezone: Type.String(),
  /** Every zone the server accepts, sorted, including "UTC". */
  timezones: Type.Array(Type.String()),
}, { additionalProperties: false });
export type TriggerListResponse = Static<typeof TriggerListResponseSchema>;

/** One saved workflow a trigger can start, read from the project's workflow library without opening a session. */
export const TriggerWorkflowSchema = Type.Object({
  name: Type.String(),
  description: Type.Optional(Type.String()),
  /** Script workflows are listed so the form can explain why they cannot be scheduled. */
  kind: Type.Union([Type.Literal("prose"), Type.Literal("script")]),
  inputs: Type.Record(Type.String(), WorkflowInputSchema),
  /** False when the route has no land stop, so the night's changes are not held for review. */
  hasLandStop: Type.Boolean(),
}, { additionalProperties: false });
export type TriggerWorkflow = Static<typeof TriggerWorkflowSchema>;
export const TriggerWorkflowsResponseSchema = Type.Object({
  workflows: Type.Array(TriggerWorkflowSchema),
  diagnostics: Type.Array(Type.Object({ name: Type.String(), path: Type.String(), error: Type.String() }, { additionalProperties: false })),
}, { additionalProperties: false });
export type TriggerWorkflowsResponse = Static<typeof TriggerWorkflowsResponseSchema>;

export const TriggerRunRequestSchema = Type.Object({ requestId: Type.String({ pattern: "^[a-zA-Z0-9-]{1,64}$" }) }, { additionalProperties: false });
export type TriggerRunRequest = Static<typeof TriggerRunRequestSchema>;
export const TriggerRunResponseSchema = Type.Object({ requestId: Type.String() }, { additionalProperties: false });
export type TriggerRunResponse = Static<typeof TriggerRunResponseSchema>;

/** Every trigger route error. `field` names the request field at fault, as a dotted path, when one is known. */
export const TriggerErrorResponseSchema = Type.Object({ error: Type.String(), field: Type.Optional(Type.String()) }, { additionalProperties: false });
export type TriggerErrorResponse = Static<typeof TriggerErrorResponseSchema>;

/** Published on the global session event stream after every change to the trigger document. Read the list again. */
export interface TriggersChangedEvent { type: "triggers.changed" }

export const DEFAULT_MISSED_GRACE_MINUTES = 360;
export const TRIGGER_HISTORY_LIMIT = 50;
export const TRIGGER_LIST_HISTORY = 7;

/** One request ID per scheduled occurrence. Every downstream receipt keys on it, so a rerun fire starts nothing new. */
export function triggerRequestId(triggerId: string, occurrence: number): string {
  return `trigger-${triggerId}-${String(occurrence)}`;
}

/** One request ID per manual run. The client picks `runRequestId`; repeating it starts nothing new. */
export function triggerManualRequestId(triggerId: string, runRequestId: string): string {
  return `trigger-${triggerId}-run-${runRequestId}`;
}
