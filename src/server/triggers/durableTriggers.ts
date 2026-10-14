import { createHash, randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import { defineDoc, defineExtension, defineTask, type ConversationId, type Harness, type Tx, type TaskRuntime } from "@earendil-works/pi-durable";
import { Check } from "typebox/value";
import { Type, type Static } from "typebox";
import { nextOccurrence, parseTriggerSchedule } from "../../shared/triggerSchedules.js";
import {
  DEFAULT_MISSED_GRACE_MINUTES, TRIGGER_HISTORY_LIMIT, TriggerCreateSchema, triggerRequestId,
  TriggerActionSchema, TriggerSchema, TriggerUpdateSchema, triggerManualRequestId, type Trigger, type TriggerAction, type TriggerFire, type TriggerCreator, type TriggerProjectFire,
} from "../../shared/triggers.js";

import { LegacyTriggerActionSchema, migrateTriggerAction, migrateTriggerStore, type StoredTriggers } from "./triggerMigration.js";
import { fireTriggerProjects, summarizeProjectFires } from "./triggerFire.js";

export const TRIGGERS_DOC_KIND = "forgerie.triggers";
export const TRIGGER_TASK_KIND = "forgerie.trigger";

/** Session-scoped: one document holds every trigger of the storage that hosts them. */
type StoredTrigger = Trigger & { readonly incarnation: string };
const Triggers = defineDoc<StoredTriggers>({
  kind: TRIGGERS_DOC_KIND, version: 2, scope: "session", initial: () => ({ records: {}, nextGeneration: 1, manualRequests: {} }),
  migrate: migrateTriggerStore,
});

export class TriggerError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 503 = 400, readonly field?: string) { super(message); }
}

/**
 * One fire handed to the host. `requestId` is the same every time this occurrence runs, including after a restart
 * in the middle of a fire. The host must key every effect on it, so that a repeated fire starts nothing new.
 */
export interface TriggerFireRequest {
  readonly triggerId: string;
  readonly name: string;
  readonly action: TriggerAction;
  readonly occurrence: number;
  readonly requestId: string;
  readonly timezone: string;
  /** Captured before admission, retained in the checkpoint even if All projects changes after restart. */
  readonly cwds?: string[];
  /** Version-1/2 fires must reuse the old single-project session UUID. */
  readonly legacySessionIdentity?: true;
}
export interface ProjectTriggerFireRequest extends Omit<TriggerFireRequest, "action"> {
  readonly action: Omit<TriggerAction, "targets"> & { readonly cwd: string };
  readonly unavailableIsSkip?: true;
}
export interface TriggerFireReceipt { readonly sessionId: string; readonly cwd: string; readonly runId: string }
export type FireTrigger = (request: ProjectTriggerFireRequest, context: Context) => Promise<TriggerFireReceipt>;

export interface DurableTriggerOptions {
  readonly fire: FireTrigger;
  /** The same clock the hosting Harness uses (`HarnessOptions.now`). */
  readonly now: () => number;
  readonly resolveProjects?: (action: TriggerAction) => Promise<string[]>;
  /** Admission can wait for host coordination without holding a storage transaction. */
  readonly beforeAdmission?: (request: TriggerFireRequest, context: Context) => Promise<void>;
}

interface TriggerTaskInput { readonly incarnation: string; readonly triggerId: string; readonly generation: number; readonly firstOccurrence: number }
interface ManualTaskInput { readonly request: TriggerFireRequest; readonly incarnation: string }
type FireAdmission = boolean | "legacy";
interface ManualCheckpoint { readonly phase: "fire"; readonly admitted: FireAdmission; readonly request?: TriggerFireRequest; readonly projects?: TriggerProjectFire[] }
type TriggerCheckpoint =
  | { readonly phase: "wait"; readonly occurrence: number; readonly skippedBefore: number }
  | { readonly phase: "fire"; readonly occurrence: number; readonly skippedBefore: number; readonly request: TriggerFireRequest; readonly admitted: FireAdmission; readonly projects?: TriggerProjectFire[] };

const RequestSchema = Type.Object({ triggerId: Type.String(), name: Type.String(), action: Type.Union([TriggerActionSchema, LegacyTriggerActionSchema]), occurrence: Type.Number(), requestId: Type.String(), timezone: Type.String(), cwds: Type.Optional(Type.Array(Type.String())), legacySessionIdentity: Type.Optional(Type.Literal(true)) }, { additionalProperties: false });
const ScheduledInputSchema = Type.Object({ incarnation: Type.String(), triggerId: Type.String(), generation: Type.Integer(), firstOccurrence: Type.Number() }, { additionalProperties: false });
const ManualInputSchema = Type.Object({ request: RequestSchema, incarnation: Type.String() }, { additionalProperties: false });
const WaitCheckpointSchema = Type.Object({ phase: Type.Literal("wait"), occurrence: Type.Number(), skippedBefore: Type.Integer() }, { additionalProperties: false });
const OldCheckpointSchema = Type.Union([WaitCheckpointSchema, Type.Object({ phase: Type.Literal("fire"), occurrence: Type.Number(), skippedBefore: Type.Integer(), request: RequestSchema, admitted: Type.Optional(Type.Union([Type.Boolean(), Type.Literal("legacy")])) }, { additionalProperties: false })]);
const OldManualCheckpointSchema = Type.Object({ phase: Type.Literal("fire"), admitted: Type.Optional(Type.Union([Type.Boolean(), Type.Literal("legacy")])), request: Type.Optional(RequestSchema) }, { additionalProperties: false });

const MINUTE = 60_000;
const ON_TIME_TOLERANCE_MS = 60_000;
const stop = { status: "terminal", outcome: { status: "completed", result: null } } as const;

/** The record a task may act for: present, active, and armed by this task's generation. */
function armedFor(record: Readonly<StoredTrigger> | undefined, input: TriggerTaskInput): boolean {
  return record?.incarnation === input.incarnation && record.state.kind === "active" && record.generation === input.generation;
}

function recordAt(records: Readonly<Record<string, StoredTrigger>>, id: string): StoredTrigger | undefined {
  return Object.hasOwn(records, id) ? records[id] : undefined;
}

// Doc drafts are transaction overlays. Materialize them before the commit settles, and check the stored shape.
function publicTrigger(record: Readonly<StoredTrigger>): Trigger {
  const plain: unknown = JSON.parse(JSON.stringify({ ...record, incarnation: undefined }));
  if (!Check(TriggerSchema, plain)) throw new Error("Invalid trigger record");
  return plain;
}
function publicAction(action: Readonly<TriggerAction>): TriggerAction {
  const plain: unknown = JSON.parse(JSON.stringify(action));
  if (!Check(TriggerActionSchema, plain)) throw new Error("Invalid trigger action");
  return plain;
}

function assertProject(action: TriggerAction, scope?: readonly string[]): void {
  if (scope !== undefined && (action.targets.kind !== "projects" || action.targets.cwds.length !== 1 || !scope.includes(action.targets.cwds[0] ?? ""))) throw new TriggerError("Triggers are limited to the calling session's project", 400, "action.targets");
}

// Completion projects receipts already recorded. Do not restore attention the user acknowledged during a partial fire.
function recordFire(record: Trigger, fire: TriggerFire, attentionPolicy: "record" | "preserve" = "record"): void {
  const previous = record.history.findIndex((entry) => entry.requestId === fire.requestId);
  if (previous >= 0) record.history.splice(previous, 1);
  record.history.unshift(fire);
  record.revision += 1;
  if (attentionPolicy === "record" && (fire.outcome.kind === "failed" || (fire.outcome.kind === "missed" && record.action.targets.kind === "projects")) && record.attention === null) record.attention = { since: fire.recordedAt };
  if (record.history.length > TRIGGER_HISTORY_LIMIT) record.history.splice(TRIGGER_HISTORY_LIMIT);
}

/**
 * Scheduled triggers as Durable tasks. Each active trigger owns one background task that sleeps until its next
 * occurrence, fires, records the outcome, and sleeps again. Durable checkpoints carry it across daemon restarts.
 */
export function durableTriggers(options: DurableTriggerOptions) {
  const { fire, now } = options;
  const resolveProjects = options.resolveProjects ?? ((action: TriggerAction) => Promise.resolve(action.targets.kind === "projects" ? [...action.targets.cwds] : []));
  const migrateRequest = (request: Static<typeof RequestSchema>): TriggerFireRequest => {
    const legacyCwd = Check(LegacyTriggerActionSchema, request.action) ? request.action.cwd : undefined;
    return { ...request, action: migrateTriggerAction(request.action), ...(legacyCwd === undefined ? {} : { cwds: [legacyCwd], legacySessionIdentity: true as const }) };
  };

  async function executeFire<I, S>(runtime: TaskRuntime<I, S, null, object>, request: TriggerFireRequest, incarnation: string, cause: TriggerFire["cause"], skippedBefore: number, context: Context, persistedAdmission: { readonly state: FireAdmission; readonly projects?: TriggerProjectFire[]; readonly checkpoint: (request: TriggerFireRequest, projects: TriggerProjectFire[]) => S }, scheduled?: TriggerTaskInput): Promise<Pick<TriggerFire, "outcome" | "projects"> | undefined> {
    if (persistedAdmission.state !== true) await options.beforeAdmission?.(request, context);
    request = { ...request, cwds: request.cwds ?? await resolveProjects(request.action) };
    const progress = { projects: persistedAdmission.projects ?? (request.cwds ?? []).map((cwd): TriggerProjectFire => ({ cwd, outcome: { kind: "running", startedAt: now() } })) };
    const admission = { accepted: false };
    await runtime.commit(async (tx) => {
      const record = recordAt((await tx.doc(Triggers)).records, request.triggerId);
      if (record?.incarnation !== incarnation) return stop;
      if (persistedAdmission.state === true) {
        admission.accepted = true;
        return undefined;
      }
      // Version 1 did not save admission in its checkpoint. Read its old evidence once, during upgrade only.
      const legacy = persistedAdmission.state === "legacy";
      const previous = legacy ? record.history.find((entry) => entry.requestId === request.requestId) : undefined;
      if (previous !== undefined && previous.outcome.kind !== "running") return stop;
      if (previous === undefined && scheduled !== undefined && !armedFor(record, scheduled)) {
        if (legacy) recordFire(record, { occurrence: request.occurrence, requestId: request.requestId, cause, recordedAt: now(), skippedBefore,
          outcome: { kind: "failed", error: "Cannot recover version-1 fire admission: its evidence is missing and the trigger is paused or superseded. Use Run now to retry." }, projects: (request.cwds ?? []).map((cwd) => ({ cwd, outcome: { kind: "failed", error: "Cannot recover version-1 fire admission. Use Run now to retry." } })) });
        return stop;
      }
      if (previous === undefined) recordFire(record, { occurrence: request.occurrence, requestId: request.requestId, cause, recordedAt: now(), skippedBefore, outcome: { kind: "running", startedAt: now() }, projects: (request.cwds ?? []).map((cwd) => ({ cwd, outcome: { kind: "running", startedAt: now() } })) });
      admission.accepted = true;
      // The task owns this receipt. Trimming display history cannot remove it.
      return { status: "running", checkpoint: persistedAdmission.checkpoint(request, progress.projects) };
    }, context);
    if (!admission.accepted) return undefined;
    const projects = await fireTriggerProjects(request, request.cwds ?? [], fire, context, progress.projects, (project) => runtime.commit(async (tx) => {
      progress.projects = progress.projects.map((previous) => previous.cwd === project.cwd ? project : previous);
      const record = recordAt((await tx.doc(Triggers)).records, request.triggerId);
      if (record?.incarnation === incarnation) {
        const entry = record.history.find((entry) => entry.requestId === request.requestId);
        if (entry !== undefined) { entry.projects = progress.projects; record.revision += 1; }
        if (project.outcome.kind === "failed" && record.attention === null) record.attention = { since: now() };
      }
      return { status: "running", checkpoint: persistedAdmission.checkpoint(request, progress.projects) };
    }, context));
    return { outcome: summarizeProjectFires(projects), projects };
  }

  const manualTask = defineTask<ManualTaskInput, ManualCheckpoint, null>({
    name: "forgerie.trigger.manual", version: 3, initial: () => ({ phase: "fire", admitted: false }),
    migrate: (input, checkpoint, fromVersion) => {
      if ((fromVersion !== 1 && fromVersion !== 2) || !Check(ManualInputSchema, input) || !Check(OldManualCheckpointSchema, checkpoint)) throw new Error("Unsupported manual trigger task migration");
      return { input: { ...input, request: migrateRequest(input.request) }, checkpoint: { phase: "fire", admitted: fromVersion === 1 ? "legacy" : checkpoint.admitted ?? false, ...(checkpoint.request === undefined ? {} : { request: migrateRequest(checkpoint.request) }) } };
    },
    phases: { fire: async (running, runtime, context) => {
      const request = running.state.checkpoint.request ?? running.input.request;
      const { incarnation } = running.input;
      const outcome = await executeFire(runtime, request, incarnation, "manual", 0, context, { state: running.state.checkpoint.admitted, ...(running.state.checkpoint.projects === undefined ? {} : { projects: running.state.checkpoint.projects }), checkpoint: (request, projects) => ({ ...running.state.checkpoint, admitted: true, request, projects }) });
      if (outcome === undefined) return;
      await runtime.commit(async (tx) => {
        const record = recordAt((await tx.doc(Triggers)).records, request.triggerId);
        if (record?.incarnation === incarnation) recordFire(record, { occurrence: request.occurrence, requestId: request.requestId, cause: "manual", skippedBefore: 0, recordedAt: now(), ...outcome }, "preserve");
        return stop;
      }, context);
    } },
    abort: (_running, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
  });

  const task = defineTask<TriggerTaskInput, TriggerCheckpoint, null>({
    name: TRIGGER_TASK_KIND, version: 3,
    migrate: (input, checkpoint, fromVersion) => {
      if ((fromVersion !== 1 && fromVersion !== 2) || !Check(ScheduledInputSchema, input) || !Check(OldCheckpointSchema, checkpoint)) throw new Error("Unsupported scheduled trigger task migration");
      return { input, checkpoint: checkpoint.phase === "wait" ? checkpoint : { ...checkpoint, request: migrateRequest(checkpoint.request), admitted: fromVersion === 1 ? "legacy" : checkpoint.admitted ?? false } };
    },
    initial: (input) => ({ phase: "wait", occurrence: input.firstOccurrence, skippedBefore: 0 }),
    phases: {
      wait: async (running, runtime, context) => {
        await runtime.sleep(running.state.checkpoint.occurrence, context);
        await runtime.commit(async (tx) => {
          const record = recordAt((await tx.doc(Triggers)).records, running.input.triggerId);
          if (record === undefined || !armedFor(record, running.input)) return stop;
          const at = runtime.now();
          // Occurrences that passed while the daemon was down fold into the latest one. It fires once, or not at all.
          let { occurrence, skippedBefore } = running.state.checkpoint;
          for (let next = nextOccurrence(record.schedule, occurrence); next <= at; next = nextOccurrence(record.schedule, next)) {
            occurrence = next;
            skippedBefore += 1;
          }
          // Timer jitter counts as on time even when the user refuses late runs. It does not extend a longer grace window.
          if (at - occurrence <= Math.max(ON_TIME_TOLERANCE_MS, record.missedGraceMinutes * MINUTE)) return { status: "running", checkpoint: { phase: "fire", admitted: false, occurrence, skippedBefore, request: { triggerId: record.id, name: record.name, timezone: record.schedule.timezone, action: publicAction(record.action), occurrence, requestId: triggerRequestId(record.id, occurrence) } } };
          recordFire(record, { occurrence, requestId: triggerRequestId(record.id, occurrence), cause: "schedule", recordedAt: at, skippedBefore, outcome: { kind: "missed" }, projects: (await resolveProjects(record.action)).map((cwd) => ({ cwd, outcome: { kind: "missed" } })) });
          const nextFireAt = nextOccurrence(record.schedule, at);
          record.state = { kind: "active", nextFireAt };
          return { status: "running", checkpoint: { phase: "wait", occurrence: nextFireAt, skippedBefore: 0 } };
        }, context);
      },
      fire: async (running, runtime, context) => {
        const { occurrence, skippedBefore } = running.state.checkpoint;
        const { triggerId } = running.input;
        const requestId = triggerRequestId(triggerId, occurrence);
        const outcome = await executeFire(runtime, running.state.checkpoint.request, running.input.incarnation, "schedule", skippedBefore, context, { state: running.state.checkpoint.admitted, ...(running.state.checkpoint.projects === undefined ? {} : { projects: running.state.checkpoint.projects }), checkpoint: (request, projects) => ({ ...running.state.checkpoint, admitted: true, request, projects }) }, running.input);
        if (outcome === undefined) return;
        await runtime.commit(async (tx) => {
          const live = recordAt((await tx.doc(Triggers)).records, triggerId);
          if (live?.incarnation !== running.input.incarnation) return stop;
          const at = runtime.now();
          recordFire(live, { occurrence, requestId, cause: "schedule", recordedAt: at, skippedBefore, ...outcome }, "preserve");
          if (!armedFor(live, running.input)) return stop;
          const nextFireAt = nextOccurrence(live.schedule, Math.max(occurrence, at));
          live.state = { kind: "active", nextFireAt };
          return { status: "running", checkpoint: { phase: "wait", occurrence: nextFireAt, skippedBefore: 0 } };
        }, context);
      },
    },
    abort: (_running, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
  });

  async function arm(tx: Tx, anchor: ConversationId, record: StoredTrigger, at: number): Promise<void> {
    const doc = await tx.doc(Triggers);
    const generation = doc.nextGeneration;
    doc.nextGeneration = generation + 1;
    const nextFireAt = nextOccurrence(record.schedule, at);
    record.generation = generation;
    record.state = { kind: "active", nextFireAt };
    await tx.createTask(task, { triggerId: record.id, incarnation: record.incarnation, generation, firstOccurrence: nextFireAt }, { ownership: { kind: "conversation" }, conversationId: anchor, background: true });
  }

  return {
    extension: defineExtension({ name: "forgerie.triggers", tasks: [task, manualTask] }),
    initialize: (harness: Harness, context: Context): Promise<void> => harness.commit(async (tx) => { await tx.doc(Triggers); }, context),

    /** Validate, store, and arm a trigger in one commit. `anchor` is the conversation that owns trigger tasks. */
    create: async (harness: Harness, anchor: ConversationId, input: unknown, context: Context, createdBy: TriggerCreator = { kind: "user" }, scope?: readonly string[]): Promise<Trigger> => {
      if (!Check(TriggerCreateSchema, input)) throw new TriggerError("Invalid trigger. Give name, schedule, and a workflow action.");
      assertProject(input.action, scope);
      const schedule = parseTriggerSchedule(input.schedule);
      return harness.commit(async (tx) => {
        const doc = await tx.doc(Triggers);
        const base = input.name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 48).replace(/-$/u, "") || "trigger";
        let id = input.id ?? base;
        if (input.id === undefined) for (let suffix = 2; recordAt(doc.records, id) !== undefined; suffix++) { const tail = `-${String(suffix)}`; id = base.slice(0, 48 - tail.length) + tail; }
        if (recordAt(doc.records, id) !== undefined) throw new TriggerError(`Trigger "${id}" already exists.`, 409, "id");
        const at = now();
        const record: StoredTrigger = {
          incarnation: randomUUID(), id, name: input.name, schedule, action: input.action,
          missedGraceMinutes: input.missedGraceMinutes ?? DEFAULT_MISSED_GRACE_MINUTES,
          createdAt: at, createdBy, revision: 1, attention: null, generation: 1, state: { kind: "paused", pausedAt: at }, history: [],
        };
        await arm(tx, anchor, record, at);
        doc.records[record.id] = record;
        return publicTrigger(record);
      }, context);
    },

    /** Stop future fires. A fire already in progress finishes and is recorded. */
    pause: (harness: Harness, id: string, context: Context, scope?: readonly string[]): Promise<Trigger> => harness.commit(async (tx) => {
      const record = recordAt((await tx.doc(Triggers)).records, id);
      if (record === undefined) throw new TriggerError(`Trigger "${id}" does not exist.`, 404);
      assertProject(record.action, scope);
      if (record.state.kind === "active") { record.state = { kind: "paused", pausedAt: now() }; record.revision += 1; }
      return publicTrigger(record);
    }, context),

    /** Arm a paused trigger from the current time. Occurrences that passed while it was paused do not fire. */
    resume: (harness: Harness, anchor: ConversationId, id: string, context: Context, scope?: readonly string[]): Promise<Trigger> => harness.commit(async (tx) => {
      const record = recordAt((await tx.doc(Triggers)).records, id);
      if (record === undefined) throw new TriggerError(`Trigger "${id}" does not exist.`, 404);
      assertProject(record.action, scope);
      if (record.state.kind === "paused") { await arm(tx, anchor, record, now()); record.revision += 1; }
      return publicTrigger(record);
    }, context),

    update: (harness: Harness, anchor: ConversationId, id: string, input: unknown, context: Context, scope?: readonly string[]): Promise<Trigger> => harness.commit(async (tx) => {
      if (!Check(TriggerUpdateSchema, input)) throw new TriggerError("Invalid trigger update");
      const record = recordAt((await tx.doc(Triggers)).records, id);
      if (record === undefined) throw new TriggerError(`Trigger "${id}" does not exist.`, 404);
      assertProject(record.action, scope);
      if (record.revision !== input.baseRevision) throw new TriggerError(`Trigger revision is ${String(record.revision)}; read it again before editing.`, 409, "baseRevision");
      if (input.name !== undefined) record.name = input.name;
      if (input.action !== undefined) { assertProject(input.action, scope); record.action = input.action; }
      if (input.schedule !== undefined) record.schedule = parseTriggerSchedule(input.schedule);
      if (input.missedGraceMinutes !== undefined) record.missedGraceMinutes = input.missedGraceMinutes;
      if ((input.schedule !== undefined || input.action !== undefined) && record.state.kind === "active") await arm(tx, anchor, record, now());
      record.revision += 1;
      return publicTrigger(record);
    }, context),

    acknowledge: (harness: Harness, id: string, context: Context, scope?: readonly string[]): Promise<Trigger> => harness.commit(async (tx) => {
      const record = recordAt((await tx.doc(Triggers)).records, id);
      if (record === undefined) throw new TriggerError(`Trigger "${id}" does not exist.`, 404);
      assertProject(record.action, scope);
      if (record.attention !== null) { record.attention = null; record.revision += 1; }
      return publicTrigger(record);
    }, context),

    run: (harness: Harness, anchor: ConversationId, id: string, clientRequestId: string, context: Context, scope?: readonly string[], cwd?: string): Promise<{ requestId: string }> => harness.commit(async (tx) => {
      const doc = await tx.doc(Triggers);
      const record = recordAt(doc.records, id);
      if (record === undefined) throw new TriggerError(`Trigger "${id}" does not exist.`, 404);
      assertProject(record.action, scope);
      if (cwd !== undefined && record.action.targets.kind === "projects" && !record.action.targets.cwds.includes(cwd)) throw new TriggerError("Choose one of the trigger's target projects", 400, "cwd");
      const receiptKey = JSON.stringify([record.incarnation, clientRequestId]);
      const requestId = triggerManualRequestId(id, createHash("sha256").update(receiptKey).digest("hex").slice(0, 32));
      if (doc.manualRequests[receiptKey] === undefined) {
        doc.manualRequests[receiptKey] = { triggerId: id, incarnation: record.incarnation };
        await tx.createTask(manualTask, { incarnation: record.incarnation, request: { triggerId: id, name: record.name, timezone: record.schedule.timezone, action: publicAction(record.action), ...(cwd === undefined ? {} : { cwds: [cwd] }), occurrence: now(), requestId } }, { ownership: { kind: "conversation" }, conversationId: anchor, background: true });
      }
      return { requestId };
    }, context),

    /** Delete the trigger and its history. Its task stops at its next phase. */
    remove: (harness: Harness, id: string, context: Context, scope?: readonly string[]): Promise<void> => harness.commit(async (tx) => {
      const doc = await tx.doc(Triggers);
      const record = recordAt(doc.records, id);
      if (record === undefined) throw new TriggerError(`Trigger "${id}" does not exist.`, 404);
      assertProject(record.action, scope);
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Records are keyed by trigger ID.
      delete doc.records[id];
      for (const [requestId, receipt] of Object.entries(doc.manualRequests)) if (receipt.triggerId === id && receipt.incarnation === record.incarnation) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Receipts are keyed by request ID.
        delete doc.manualRequests[requestId];
      }
    }, context),
  };
}

export async function listTriggers(harness: Harness, context: Context): Promise<Trigger[]> {
  const doc = await harness.snapshot(Triggers, context);
  return Object.values(doc?.records ?? {}).map(publicTrigger).sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}
