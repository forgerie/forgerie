import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import { LiveDoc, UsageDoc, UserEntry, type CommitPublication, type ConversationId, type Cursor, type Harness,
  type SubmissionId, type SubmissionRecord, type TaskId } from "@earendil-works/pi-durable";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { ChildRunUsageSchema, ChildRunUsageStateSchema, type ChildRun } from "../../shared/childRuns.js";
import { ChildRunStore, type ChildRunCheckpoint } from "./childRunStore.js";
import { CHILD_AGENTS_DOC_KIND, durableChildRunMetadata } from "./durableChildAgents.js";
import type { DurableChildSessionRef } from "./durableChildHost.js";
import { activeWorkflowRun, workflowActiveFromCommit } from "./durableWorkflowRuns.js";

// SDK IDs are opaque numbers. These schemas validate the persisted/publication boundary before restoring the brand.
const positive = Type.Integer({ minimum: 1 });
const liveSchema = Type.Object({ run: Type.Optional(Type.Object({ taskId: Type.Unsafe<TaskId>(positive), inputs: Type.Array(Type.Unsafe<SubmissionId>(positive)) })) });
const metadataSchema = Type.Object({ agents: Type.Record(Type.String(), Type.Object({ conversationId: Type.Unsafe<ConversationId>(positive), agent: Type.Union([Type.String(), Type.Null()]),
  agentFile: Type.Optional(Type.Object({ path: Type.String(), sha256: Type.String() })) })) });
const modelSchema = Type.Object({ model: Type.Object({ provider: Type.String(), modelId: Type.String() }) });
const userSchema = Type.Object({ model: Type.Array(Type.Object({ role: Type.Literal("user"), timestamp: Type.Integer({ minimum: 0 }) })) });
type UsageState = Static<typeof ChildRunUsageStateSchema>;
type Usage = Static<typeof ChildRunUsageSchema>;
type Live = Static<typeof liveSchema>["run"];
type Metadata = Static<typeof metadataSchema>["agents"][string] & { name: string };
interface Generation { id: TaskId; startedAt?: number; endedAt?: number; model?: NonNullable<ChildRun["model"]> }
interface Active { run: ChildRun; checkpoint: ChildRunCheckpoint; stored?: string }
interface Child { metadata: Metadata; usage: UsageState; live: Live; generations: Map<number, Generation>; active?: Active }

/** Exact committed frames, not provider callbacks or bounded event streams. It never calls Session APIs in a listener. */
export class DurableChildRunRecords {
  private readonly children = new Map<number, Child>();
  private workflowRunId: string | undefined;
  private writes: Promise<void> = Promise.resolve();
  private writeFailure: Error | undefined;
  private unsubscribe: (() => void) | undefined;
  private constructor(private readonly ref: DurableChildSessionRef, private readonly store: ChildRunStore,
    private readonly onError: (error: unknown) => void, private readonly now: () => number, private readonly onFinished?: (run: ChildRun) => Promise<void>) {}

  /** Must attach before the hosted session enables scheduling. Reads alone never resume the harness. */
  static async open(harness: Harness, parent: ConversationId, ref: DurableChildSessionRef, store: ChildRunStore, context: Context,
    onError: (error: unknown) => void, now: () => number = Date.now, onFinished?: (run: ChildRun) => Promise<void>): Promise<DurableChildRunRecords> {
    const recorder = new DurableChildRunRecords(ref, store, onError, now, onFinished);
    recorder.workflowRunId = await activeWorkflowRun(harness, parent, context);
    const pending = await store.pending(ref.id);
    const metadata = await durableChildRunMetadata(harness, parent, context);
    for (const [name, value] of Object.entries(metadata)) {
      const child = recorder.child({ ...value, name });
      child.usage = structuredClone(await harness.snapshot(UsageDoc, value.conversationId, context) ?? { models: {}, tools: {} });
      child.live = (await harness.snapshot(LiveDoc, value.conversationId, context))?.run;
      await harness.commit(async (tx) => {
        let cursor: Cursor | undefined;
        do {
          const page = await tx.scanTasks({ conversationId: value.conversationId, kind: "pi.generation" }, 100, cursor);
          for (const task of page.items) child.generations.set(task.id, { id: task.id, ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }), ...(task.endedAt === undefined ? {} : { endedAt: task.endedAt }) });
          cursor = page.next;
        } while (cursor !== undefined);
      }, context);
      const previous = pending.find((item) => item.run.child.conversationId === value.conversationId);
      if (previous?.checkpoint !== undefined) {
        child.active = { run: previous.run, checkpoint: previous.checkpoint };
        const submission = await (await harness.submission(previous.checkpoint.submissionId, context))?.status(context);
        if (submission?.status === "done" || submission?.status === "unanswered") {
          const upper = submission.status === "done" && submission.type === "input" ? submission.answer : undefined;
          const checkpoint = previous.checkpoint;
          const tasks = [...child.generations.values()].filter((task) => task.id >= checkpoint.rootTaskId && (upper === undefined || task.id < upper));
          const last = tasks.sort((a, b) => a.id - b.id).at(-1);
          if (last !== undefined) child.active.checkpoint.generationTaskId = last.id;
          const later = upper === undefined || [...child.generations.keys()].some((id) => id > upper);
          recorder.finish(child, submission, later ? null : child.usage, upper === undefined ? undefined : Math.max(...tasks.map((task) => task.endedAt ?? 0)), "recovered");
        }
      }
      const live = child.live;
      const first = live?.inputs[0];
      if (live !== undefined && first !== undefined && child.active?.checkpoint.submissionId !== first) {
        const submission = await (await harness.submission(first, context))?.status(context);
        const entry = submission?.type === "input" && (submission.status === "placed" || submission.status === "done") ? submission.entry : undefined;
        const user = entry === undefined ? undefined : await harness.commit((tx) => tx.entry(UserEntry, entry), context);
        const root = entry === undefined ? live.taskId : [...child.generations.keys()].filter((id) => id > entry).sort((a, b) => a - b)[0] ?? live.taskId;
        const rootTask = child.generations.get(root);
        recorder.begin(child, first, rootTask?.id ?? live.taskId, user?.model?.[0]?.timestamp ?? rootTask?.startedAt ?? now(), null);
      }
    }
    await recorder.flush();
    recorder.unsubscribe = harness.subscribeCommits((publication) => {
      try { recorder.adopt(publication, parent); } catch (error) { onError(error); }
    });
    return recorder;
  }

  async close(): Promise<void> { this.unsubscribe?.(); this.unsubscribe = undefined; await this.flush(); }
  async flush(): Promise<void> { await this.writes; if (this.writeFailure !== undefined) throw this.writeFailure; }

  private child(metadata: Metadata): Child {
    let child = this.children.get(metadata.conversationId);
    if (child === undefined) {
      child = { metadata, usage: { models: {}, tools: {} }, live: undefined, generations: new Map() };
      this.children.set(metadata.conversationId, child);
    } else child.metadata = metadata;
    return child;
  }

  private adopt(publication: CommitPublication, parent: ConversationId): void {
    const workflow = workflowActiveFromCommit(publication, parent);
    if (workflow !== undefined) this.workflowRunId = workflow.active ?? undefined;
    for (const change of publication.changes) {
      if (change.type === "document" && change.conversationId === parent && change.record.kind === CHILD_AGENTS_DOC_KIND && Check(metadataSchema, change.value)) {
        for (const [name, metadata] of Object.entries(change.value.agents)) this.child({ ...metadata, name });
      }
    }
    const next = new Map<number, { live?: Live; usage?: UsageState; time?: number; settled?: SubmissionRecord }>();
    for (const change of publication.changes) {
      const id = change.type === "document" ? change.conversationId
        : change.type === "task" || change.type === "entry" || change.type === "submission" ? change.value.conversationId : undefined;
      if (id === undefined) continue;
      const child = this.children.get(id);
      if (child === undefined) continue;
      let update = next.get(id);
      if (update === undefined) { update = {}; next.set(id, update); }
      if (change.type === "document" && change.record.kind === "pi.live" && Check(liveSchema, change.value)) update.live = change.value.run;
      if (change.type === "document" && change.record.kind === "pi.usage" && Check(ChildRunUsageStateSchema, change.value)) update.usage = change.value;
      if (change.type === "entry" && change.value.kind === "pi.user" && Check(userSchema, change.value.data)) {
        const timestamp = change.value.data.model[0]?.timestamp;
        if (timestamp !== undefined) update.time = timestamp;
      }
      if (change.type === "submission" && change.value.id === child.active?.checkpoint.submissionId) update.settled = change.value;
      if (change.type === "task" && change.value.kind === "pi.generation") {
        const task = change.value;
        child.generations.set(task.id, { id: task.id, ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }), ...(task.endedAt === undefined ? {} : { endedAt: task.endedAt }),
          ...(task.state.status !== "terminal" && task.state.status !== "completing" && Check(modelSchema, task.state.checkpoint) ? { model: task.state.checkpoint.model } : {}) });
      }
    }
    for (const [id, update] of next) {
      const child = this.children.get(id);
      if (child === undefined) continue;
      const live = Object.hasOwn(update, "live") ? update.live : child.live;
      const usage = update.usage ?? child.usage;
      const first = live?.inputs[0];
      if (child.active !== undefined && child.active.checkpoint.submissionId !== first) {
        const end = child.generations.get(child.active.checkpoint.generationTaskId)?.endedAt;
        this.finish(child, update.settled, usage, end, "observed");
      }
      child.usage = usage;
      child.live = live;
      if (live !== undefined && first !== undefined && child.active === undefined) this.begin(child, first, live.taskId, update.time ?? this.now(), usage);
      if (child.active !== undefined && live !== undefined) {
        child.active.checkpoint.generationTaskId = live.taskId;
        this.refresh(child, usage);
        this.persist(child.active);
      }
    }
  }

  private begin(child: Child, submissionId: SubmissionId, rootTaskId: TaskId, startedAt: number, baseline: UsageState | null): void {
    const metadata = child.metadata;
    const id = createHash("sha256").update(`${this.ref.id}/${String(metadata.conversationId)}/${String(submissionId)}`).digest("hex");
    child.active = { run: { id, ...(this.workflowRunId === undefined ? {} : { workflowRunId: this.workflowRunId }), session: { ...this.ref }, child: { name: metadata.name, conversationId: metadata.conversationId, agent: metadata.agent,
      ...(metadata.agentFile === undefined ? {} : { agentFile: metadata.agentFile }) }, model: null, startedAt,
      state: { kind: "running" }, turns: 0, usage: baseline === null ? null : { models: {}, tools: {} } },
      checkpoint: { submissionId, rootTaskId, generationTaskId: rootTaskId, baseline } };
    this.persist(child.active);
  }

  private refresh(child: Child, usage: UsageState | null): void {
    const active = child.active;
    if (active === undefined) return;
    const tasks = [...child.generations.values()].filter((task) => task.id >= active.checkpoint.rootTaskId && task.id <= active.checkpoint.generationTaskId);
    active.run.turns = tasks.filter((task) => task.startedAt !== undefined).length;
    active.run.model ??= tasks.find((task) => task.model !== undefined)?.model ?? null;
    active.run.usage = usage === null || active.checkpoint.baseline === null ? null : usageDelta(usage, active.checkpoint.baseline);
  }

  private finish(child: Child, settled: SubmissionRecord | undefined, usage: UsageState | null, endedAt: number | undefined, timing: "observed" | "recovered"): void {
    const active = child.active;
    if (active === undefined) return;
    this.refresh(child, usage);
    const finishedAt = Math.max(active.run.startedAt, endedAt === undefined || endedAt === 0 ? this.now() : endedAt);
    active.run.state = { kind: "finished", outcome: settled?.status === "done" ? "answered" : settled?.status === "unanswered" && settled.reason === "aborted" ? "stopped" : "failed",
      finishedAt, durationMs: finishedAt - active.run.startedAt, timing };
    this.persist(active);
    delete child.active;
  }

  private persist(active: Active): void {
    const run = structuredClone(active.run);
    const checkpoint = run.state.kind === "running" ? structuredClone(active.checkpoint) : undefined;
    const serialized = JSON.stringify({ run, checkpoint });
    if (active.stored === serialized) return;
    active.stored = serialized;
    this.writes = this.writes.then(async () => {
      // Stop before publishing completion. A crash leaves a pending run to retry on recovery.
      if (run.state.kind === "finished") await this.onFinished?.(run);
      await this.store.save(run, checkpoint); this.writeFailure = undefined; })
      .catch((error: unknown) => { delete active.stored;
        this.writeFailure = error instanceof Error ? error : new Error("Child run persistence failed", { cause: error });
        this.onError(this.writeFailure); });
  }
}

/** Only committed pi.usage deltas. Tool spend stays separate; no estimate is made for a missing baseline. */
function usageDelta(current: UsageState, baseline: UsageState): UsageState {
  const subtract = (a: number, b = 0): number => Math.max(0, a - b);
  function bucket(values: Record<string, Usage>, prior: Record<string, Usage>): Record<string, Usage> {
    return Object.fromEntries(Object.entries(values).flatMap(([name, usage]) => {
      const old = Object.hasOwn(prior, name) ? prior[name] : undefined;
      const value: Usage = { input: subtract(usage.input, old?.input), output: subtract(usage.output, old?.output), cacheRead: subtract(usage.cacheRead, old?.cacheRead),
        cacheWrite: subtract(usage.cacheWrite, old?.cacheWrite), totalTokens: subtract(usage.totalTokens, old?.totalTokens),
        ...(usage.reasoning === undefined ? {} : { reasoning: subtract(usage.reasoning, old?.reasoning) }),
        ...(usage.cacheWrite1h === undefined ? {} : { cacheWrite1h: subtract(usage.cacheWrite1h, old?.cacheWrite1h) }),
        cost: { input: subtract(usage.cost.input, old?.cost.input), output: subtract(usage.cost.output, old?.cost.output), cacheRead: subtract(usage.cost.cacheRead, old?.cost.cacheRead),
          cacheWrite: subtract(usage.cost.cacheWrite, old?.cost.cacheWrite), total: subtract(usage.cost.total, old?.cost.total) } };
      return value.totalTokens === 0 && value.cost.total === 0 && value.input === 0 && value.output === 0 && value.cacheRead === 0 && value.cacheWrite === 0 && (value.reasoning ?? 0) === 0 && (value.cacheWrite1h ?? 0) === 0 ? [] : [[name, value]];
    }));
  }
  return { models: bucket(current.models, baseline.models), tools: bucket(current.tools, baseline.tools) };
}
