import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { PullLinkSchema } from "../../shared/pullRequests.js";
import { canonicalizeStoredCwd } from "../workingDirectory.js";

export const WatchCursorSchema = Type.Object({ headSha: Type.String(), failed: Type.Array(Type.String()), passed: Type.Array(Type.String()), conflicting: Type.Boolean(), remarksThrough: Type.String(), remarkIds: Type.Array(Type.String()), commentWakes: Type.Integer({ minimum: 0 }) });
export type WatchCursor = Static<typeof WatchCursorSchema>;
const RecordSchema = Type.Intersect([PullLinkSchema, Type.Object({ revision: Type.Integer({ minimum: 0 }), startLeaf: Type.Optional(Type.Union([Type.String(), Type.Null()])), lastReadAt: Type.Optional(Type.String()), cursor: Type.Optional(WatchCursorSchema), pending: Type.Optional(Type.Object({ id: Type.String(), text: Type.String() })) })]);
export type PullRecord = Static<typeof RecordSchema>;
const FileSchema = Type.Object({ version: Type.Literal(1), records: Type.Array(RecordSchema) });

/** One durable owner for links, watch checkpoints, and undelivered news. Writes publish only after rename. */
export class PullRequestStore {
  private records: PullRecord[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path?: string) {}

  async initialize(): Promise<void> {
    if (this.path === undefined) return;
    let text: string;
    try { text = await readFile(this.path, "utf8"); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return; throw error; }
    const data: unknown = JSON.parse(text);
    if (!Check(FileSchema, data)) throw new Error("Invalid pull request state file. Restore it before starting the daemon.");
    if (new Set(data.records.map((record) => record.session.id)).size !== data.records.length) throw new Error("Duplicate pull request session links.");
    this.records = data.records;
  }

  list(): PullRecord[] { return structuredClone(this.records); }
  get(id: string): PullRecord | undefined { return structuredClone(this.records.find((record) => record.session.id === id)); }
  isWatching(id: string): boolean { return this.records.some((record) => record.session.id === id && record.watch.kind === "watching"); }

  link(input: { id: string; cwd: string; repo: string; number: number }): Promise<PullRecord> {
    return this.exclusive(async () => {
      const current = this.get(input.id);
      const cwd = canonicalizeStoredCwd(input.cwd);
      if (current !== undefined && current.session.cwd !== cwd) throw new Error("Session link belongs to another workspace.");
      if (current?.repo.toLowerCase() === input.repo.toLowerCase() && current.number === input.number) return current;
      const next: PullRecord = { session: { id: input.id, cwd }, repo: input.repo, number: input.number, watch: { kind: "off" }, revision: (current?.revision ?? -1) + 1 };
      await this.persist([...this.records.filter((record) => record.session.id !== input.id), next]);
      return structuredClone(next);
    });
  }

  /** Compare-and-write invalidates every poll that began before Stop, relink, or another update. */
  update(id: string, revision: number, change: (record: PullRecord) => PullRecord): Promise<PullRecord | undefined> {
    return this.exclusive(async () => {
      const current = this.get(id);
      if (current?.revision !== revision) return undefined;
      const next = { ...change(current), revision: current.revision + 1 };
      if (!Check(RecordSchema, next) || next.session.id !== current.session.id || next.session.cwd !== current.session.cwd) throw new Error("Invalid pull request state update.");
      await this.persist(this.records.map((record) => record.session.id === id ? next : record));
      return structuredClone(next);
    });
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async persist(records: PullRecord[]): Promise<void> {
    if (!Check(FileSchema, { version: 1, records })) throw new Error("Invalid pull request state.");
    if (this.path !== undefined) {
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try { await writeFile(temp, `${JSON.stringify({ version: 1, records }, null, 2)}\n`, { mode: 0o600 }); await rename(temp, this.path); }
      finally { await rm(temp, { force: true }); }
    }
    this.records = structuredClone(records);
  }
}
