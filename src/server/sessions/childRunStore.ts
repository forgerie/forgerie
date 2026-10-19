import { randomUUID } from "node:crypto";
import type { SubmissionId, TaskId } from "@earendil-works/pi-durable";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { CHILD_RUN_RETENTION_DAYS, ChildRunSchema, ChildRunUsageStateSchema, type ChildRun, type ChildRunFilter } from "../../shared/childRuns.js";

const checkpointSchema = Type.Object({
  submissionId: Type.Unsafe<SubmissionId>(Type.Integer({ minimum: 1 })),
  rootTaskId: Type.Unsafe<TaskId>(Type.Integer({ minimum: 1 })),
  generationTaskId: Type.Unsafe<TaskId>(Type.Integer({ minimum: 1 })),
  baseline: Type.Union([ChildRunUsageStateSchema, Type.Null()]),
});
export type ChildRunCheckpoint = Static<typeof checkpointSchema>;
const itemSchema = Type.Object({ run: ChildRunSchema, checkpoint: Type.Optional(checkpointSchema) });
const fileSchema = Type.Object({ version: Type.Literal(1), records: Type.Array(itemSchema) }, { additionalProperties: false });
type StoredRun = Static<typeof itemSchema>;

/**
 * One sessiond owns this file. Retained completions are immutable; expired completions are never inserted.
 * The records stay in memory after the first read: the browser polls the run list every few seconds
 * for each open session, and the file holds every run of the last 90 days. A change made to the file
 * by anything else is not seen until the next sessiond start.
 */
export class ChildRunStore {
  private queue: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  /** Loaded records, or undefined before the first successful read. Never handed out; results are copies. */
  private records: StoredRun[] | undefined;
  constructor(private readonly path: string, private readonly now: () => number = Date.now) {}

  async list(filter: ChildRunFilter = {}): Promise<ChildRun[]> {
    return this.exclusive(async () => structuredClone((await this.retained()).filter(({ run }) =>
      (filter.session === undefined || run.session.id === filter.session) && (filter.agent === undefined || run.child.agent === filter.agent))
      .map(({ run }) => run).sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id))));
  }

  async pending(session?: string): Promise<StoredRun[]> {
    return this.exclusive(async () => structuredClone((await this.retained()).filter(({ run }) => (session === undefined || run.session.id === session) && run.state.kind === "running")));
  }

  save(run: ChildRun, checkpoint?: ChildRunCheckpoint): Promise<void> {
    const input: StoredRun = structuredClone({ run, ...(checkpoint === undefined ? {} : { checkpoint }) });
    return this.exclusive(async () => {
      const run = input.run;
      if (!Check(itemSchema, input)) throw new Error("Invalid child run record");
      if (!validTiming(run)) throw new Error("Invalid child run timing");
      const records = await this.retained();
      const previous = records.find((item) => item.run.id === run.id);
      if (previous !== undefined && (previous.run.session.id !== run.session.id || previous.run.child.conversationId !== run.child.conversationId || previous.run.startedAt !== run.startedAt)) throw new Error("Child run identity changed");
      if (this.expired(input)) {
        if (previous !== undefined) await this.persist(records.filter((item) => item.run.id !== run.id));
        return;
      }
      if (previous?.run.state.kind === "finished") return;
      await this.persist([...records.filter((item) => item.run.id !== run.id), input]);
    });
  }

  start(onError: (error: unknown) => void, intervalMs = 24 * 60 * 60_000): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => { void this.list().catch(onError); }, intervalMs);
    this.timer.unref();
  }
  async stop(): Promise<void> { clearInterval(this.timer); this.timer = undefined; await this.queue; }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => undefined);
    return pending;
  }
  private expired({ run }: StoredRun): boolean {
    return run.state.kind === "finished" && run.state.finishedAt <= this.now() - CHILD_RUN_RETENTION_DAYS * 86_400_000;
  }
  private async retained(): Promise<StoredRun[]> {
    const loaded = this.records ?? await this.load();
    const records = loaded.filter((item) => !this.expired(item));
    if (records.length !== loaded.length) await this.persist(records);
    else this.records = loaded;
    return records;
  }
  /** A file that cannot be read or validated is never cached: the next call reads it again. */
  private async load(): Promise<StoredRun[]> {
    let source: string;
    try { source = await readFile(this.path, "utf8"); }
    catch (error) { if (missing(error)) return []; throw error; }
    const value: unknown = JSON.parse(source);
    if (!Check(fileSchema, value)) throw new Error("Invalid child run file; it has not been overwritten");
    const ids = new Set<string>();
    for (const item of value.records) {
      if (!validTiming(item.run)) throw new Error("Invalid child run timing; it has not been overwritten");
      if (ids.has(item.run.id)) throw new Error("Duplicate child run ID");
      ids.add(item.run.id);
    }
    return value.records;
  }
  /** Memory follows the file: records are replaced only after the rename succeeds. */
  private async persist(records: StoredRun[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify({ version: 1, records })}\n`, { mode: 0o600 }); await rename(temporary, this.path); }
    finally { await unlink(temporary).catch((error: unknown) => { if (!missing(error)) throw error; }); }
    this.records = records;
  }
}
function validTiming(run: ChildRun): boolean {
  return run.state.kind === "running" || (run.state.finishedAt >= run.startedAt && run.state.durationMs === run.state.finishedAt - run.startedAt);
}
function missing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
