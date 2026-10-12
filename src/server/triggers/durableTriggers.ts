import type { Context } from "@earendil-works/chord";
import { defineDoc, defineExtension, defineTask, type ConversationId, type Harness, type Tx } from "@earendil-works/pi-durable";
import { Check } from "typebox/value";
import { nextOccurrence, parseTriggerSchedule } from "../../shared/triggerSchedules.js";
import {
  DEFAULT_MISSED_GRACE_MINUTES, TRIGGER_HISTORY_LIMIT, TriggerCreateSchema, triggerRequestId,
  TriggerActionSchema, TriggerSchema, type Trigger, type TriggerAction, type TriggerFire,
} from "../../shared/triggers.js";

export const TRIGGERS_DOC_KIND = "forgerie.triggers";
export const TRIGGER_TASK_KIND = "forgerie.trigger";

/** Session-scoped: one document holds every trigger of the storage that hosts them. */
const Triggers = defineDoc<{ records: Record<string, Trigger>; nextGeneration: number }>({
  kind: TRIGGERS_DOC_KIND, version: 1, scope: "session", initial: () => ({ records: {}, nextGeneration: 1 }),
});

export class TriggerError extends Error {}

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
}
export interface TriggerFireReceipt { readonly sessionId: string; readonly runId: string }
export type FireTrigger = (request: TriggerFireRequest, context: Context) => Promise<TriggerFireReceipt>;

export interface DurableTriggerOptions {
  readonly fire: FireTrigger;
  /** The same clock the hosting Harness uses (`HarnessOptions.now`). */
  readonly now: () => number;
}

interface TriggerTaskInput { readonly triggerId: string; readonly generation: number; readonly firstOccurrence: number }
type TriggerCheckpoint =
  | { readonly phase: "wait"; readonly occurrence: number; readonly skippedBefore: number }
  | { readonly phase: "fire"; readonly occurrence: number; readonly skippedBefore: number };

const MINUTE = 60_000;
const stop = { status: "terminal", outcome: { status: "completed", result: null } } as const;

/** The record a task may act for: present, active, and armed by this task's generation. */
function armedFor(record: Readonly<Trigger> | undefined, input: TriggerTaskInput): boolean {
  return record?.state.kind === "active" && record.generation === input.generation;
}

// Doc drafts are transaction overlays. Materialize them before the commit settles, and check the stored shape.
function publicTrigger(record: Readonly<Trigger>): Trigger {
  const plain: unknown = JSON.parse(JSON.stringify(record));
  if (!Check(TriggerSchema, plain)) throw new Error("Invalid trigger record");
  return plain;
}
function publicAction(action: Readonly<TriggerAction>): TriggerAction {
  const plain: unknown = JSON.parse(JSON.stringify(action));
  if (!Check(TriggerActionSchema, plain)) throw new Error("Invalid trigger action");
  return plain;
}

function recordFire(record: Trigger, fire: TriggerFire): void {
  record.history.unshift(fire);
  if (record.history.length > TRIGGER_HISTORY_LIMIT) record.history.splice(TRIGGER_HISTORY_LIMIT);
}

/**
 * Scheduled triggers as Durable tasks. Each active trigger owns one background task that sleeps until its next
 * occurrence, fires, records the outcome, and sleeps again. Durable checkpoints carry it across daemon restarts.
 */
export function durableTriggers(options: DurableTriggerOptions) {
  const { fire, now } = options;

  const task = defineTask<TriggerTaskInput, TriggerCheckpoint, null>({
    name: TRIGGER_TASK_KIND, version: 1,
    initial: (input) => ({ phase: "wait", occurrence: input.firstOccurrence, skippedBefore: 0 }),
    phases: {
      wait: async (running, runtime, context) => {
        await runtime.sleep(running.state.checkpoint.occurrence, context);
        await runtime.commit(async (tx) => {
          const record = (await tx.doc(Triggers)).records[running.input.triggerId];
          if (record === undefined || !armedFor(record, running.input)) return stop;
          const at = runtime.now();
          // Occurrences that passed while the daemon was down fold into the latest one. It fires once, or not at all.
          let { occurrence, skippedBefore } = running.state.checkpoint;
          for (let next = nextOccurrence(record.schedule, occurrence); next <= at; next = nextOccurrence(record.schedule, next)) {
            occurrence = next;
            skippedBefore += 1;
          }
          if (at - occurrence <= record.missedGraceMinutes * MINUTE) return { status: "running", checkpoint: { phase: "fire", occurrence, skippedBefore } };
          recordFire(record, { occurrence, requestId: triggerRequestId(record.id, occurrence), recordedAt: at, skippedBefore, outcome: { kind: "missed" } });
          const nextFireAt = nextOccurrence(record.schedule, at);
          record.state = { kind: "active", nextFireAt };
          return { status: "running", checkpoint: { phase: "wait", occurrence: nextFireAt, skippedBefore: 0 } };
        }, context);
      },
      fire: async (running, runtime, context) => {
        const { occurrence, skippedBefore } = running.state.checkpoint;
        const { triggerId } = running.input;
        const record = (await runtime.snapshot(Triggers, context))?.records[triggerId];
        if (record === undefined || !armedFor(record, running.input)) {
          await runtime.commit(() => stop, context);
          return;
        }
        const requestId = triggerRequestId(triggerId, occurrence);
        let outcome: TriggerFire["outcome"];
        try {
          outcome = { kind: "started", ...await fire({ triggerId, name: record.name, action: publicAction(record.action), occurrence, requestId }, context) };
        } catch (error) {
          // A closing daemon cancels the fire. Leave the checkpoint at "fire" so the next start reruns this occurrence.
          if (runtime.signal.aborted || context.abortSignal?.aborted === true) throw error;
          outcome = { kind: "failed", error: error instanceof Error ? error.message : String(error) };
        }
        await runtime.commit(async (tx) => {
          const live = (await tx.doc(Triggers)).records[triggerId];
          if (live === undefined) return stop;
          const at = runtime.now();
          recordFire(live, { occurrence, requestId, recordedAt: at, skippedBefore, outcome });
          if (!armedFor(live, running.input)) return stop;
          const nextFireAt = nextOccurrence(live.schedule, Math.max(occurrence, at));
          live.state = { kind: "active", nextFireAt };
          return { status: "running", checkpoint: { phase: "wait", occurrence: nextFireAt, skippedBefore: 0 } };
        }, context);
      },
    },
    abort: (_running, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
  });

  async function arm(tx: Tx, anchor: ConversationId, record: Trigger, at: number): Promise<void> {
    const doc = await tx.doc(Triggers);
    const generation = doc.nextGeneration;
    doc.nextGeneration = generation + 1;
    const nextFireAt = nextOccurrence(record.schedule, at);
    record.generation = generation;
    record.state = { kind: "active", nextFireAt };
    await tx.createTask(task, { triggerId: record.id, generation, firstOccurrence: nextFireAt }, { ownership: { kind: "conversation" }, conversationId: anchor, background: true });
  }

  return {
    extension: defineExtension({ name: "forgerie.triggers", tasks: [task] }),

    /** Validate, store, and arm a trigger in one commit. `anchor` is the conversation that owns trigger tasks. */
    create: async (harness: Harness, anchor: ConversationId, input: unknown, context: Context): Promise<Trigger> => {
      if (!Check(TriggerCreateSchema, input)) throw new TriggerError("Invalid trigger. Give id, name, schedule, and a workflow action.");
      const schedule = parseTriggerSchedule(input.schedule);
      return harness.commit(async (tx) => {
        const doc = await tx.doc(Triggers);
        if (doc.records[input.id] !== undefined) throw new TriggerError(`Trigger "${input.id}" already exists.`);
        const at = now();
        const record: Trigger = {
          id: input.id, name: input.name, schedule, action: input.action,
          missedGraceMinutes: input.missedGraceMinutes ?? DEFAULT_MISSED_GRACE_MINUTES,
          createdAt: at, generation: 1, state: { kind: "paused", pausedAt: at }, history: [],
        };
        await arm(tx, anchor, record, at);
        doc.records[record.id] = record;
        return publicTrigger(record);
      }, context);
    },

    /** Stop future fires. A fire already in progress finishes and is recorded. */
    pause: (harness: Harness, id: string, context: Context): Promise<Trigger> => harness.commit(async (tx) => {
      const record = (await tx.doc(Triggers)).records[id];
      if (record === undefined) throw new TriggerError(`Trigger "${id}" does not exist.`);
      if (record.state.kind === "active") record.state = { kind: "paused", pausedAt: now() };
      return publicTrigger(record);
    }, context),

    /** Arm a paused trigger from the current time. Occurrences that passed while it was paused do not fire. */
    resume: (harness: Harness, anchor: ConversationId, id: string, context: Context): Promise<Trigger> => harness.commit(async (tx) => {
      const record = (await tx.doc(Triggers)).records[id];
      if (record === undefined) throw new TriggerError(`Trigger "${id}" does not exist.`);
      if (record.state.kind === "paused") await arm(tx, anchor, record, now());
      return publicTrigger(record);
    }, context),

    /** Delete the trigger and its history. Its task stops at its next phase. */
    remove: (harness: Harness, id: string, context: Context): Promise<void> => harness.commit(async (tx) => {
      const doc = await tx.doc(Triggers);
      if (doc.records[id] === undefined) throw new TriggerError(`Trigger "${id}" does not exist.`);
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Records are keyed by trigger ID.
      delete doc.records[id];
    }, context),
  };
}

export async function listTriggers(harness: Harness, context: Context): Promise<Trigger[]> {
  const doc = await harness.snapshot(Triggers, context);
  return Object.values(doc?.records ?? {}).map(publicTrigger).sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}
