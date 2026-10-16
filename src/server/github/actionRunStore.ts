import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { ActionRunLinkSchema, type ActionRunLink } from "../../shared/actionRuns.js";
import { canonicalizeStoredCwd } from "../workingDirectory.js";

export const ActionRunCursorSchema = Type.Object({ attempt: Type.Integer({ minimum: 1 }), failed: Type.Array(Type.String()), concluded: Type.Boolean() });
export type ActionRunCursor = Static<typeof ActionRunCursorSchema>;
const RecordSchema = Type.Intersect([ActionRunLinkSchema, Type.Object({ revision: Type.Integer({ minimum: 0 }), startLeaf: Type.Optional(Type.Union([Type.String(), Type.Null()])), lastReadAt: Type.Optional(Type.String()), cursor: Type.Optional(ActionRunCursorSchema), pending: Type.Optional(Type.Object({ id: Type.String(), text: Type.String() })) })]);
export type ActionRunRecord = Static<typeof RecordSchema>;
const FileSchema = Type.Object({ version: Type.Literal(1), records: Type.Array(RecordSchema) });
const VERSION = 1;

/** One session's link to one action run. Repository names compare without case, as GitHub does. */
export interface ActionRunKey { id: string; repo: string; runId: number }
export const keyOf = (record: ActionRunRecord): ActionRunKey => ({ id: record.session.id, repo: record.repo, runId: record.runId });
const sameKey = (record: ActionRunRecord, key: ActionRunKey) => record.session.id === key.id && record.runId === key.runId && record.repo.toLowerCase() === key.repo.toLowerCase();
const keyText = (key: ActionRunKey) => `${key.id}\n${key.repo.toLowerCase()}\n${String(key.runId)}`;

/** One durable owner for links, watch checkpoints, and undelivered news. Writes publish only after rename. */
export class ActionRunStore {
  private records: ActionRunRecord[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path?: string) {}

  async initialize(): Promise<void> {
    if (this.path === undefined) return;
    let text: string;
    try { text = await readFile(this.path, "utf8"); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return; throw error; }
    const data: unknown = JSON.parse(text);
    if (!Check(FileSchema, data)) throw new Error("Invalid action run state file. Restore it before starting the daemon.");
    if (new Set(data.records.map((record) => keyText(keyOf(record)))).size !== data.records.length) throw new Error("Duplicate action run session links.");
    this.records = data.records;
  }

  list(): ActionRunRecord[] { return structuredClone(this.records); }
  /** A session's links, oldest first. */
  forSession(id: string): ActionRunRecord[] { return structuredClone(this.records.filter((record) => record.session.id === id)); }
  get(key: ActionRunKey): ActionRunRecord | undefined { return structuredClone(this.records.find((record) => sameKey(record, key))); }
  /** Any of the session's action runs is watched. */
  isWatching(id: string): boolean { return this.records.some((record) => record.session.id === id && record.watch.kind === "watching"); }

  /** Adds a link, or returns the existing one. Never replaces another action run's link. */
  link(input: { id: string; cwd: string; repo: string; runId: number; source: ActionRunLink["source"] }): Promise<ActionRunRecord> {
    return this.exclusive(async () => {
      const cwd = canonicalizeStoredCwd(input.cwd);
      // A chat may link runs from several owned workspaces. The workspace of an
      // existing run link stays immutable; a different run is an independent key.
      const other = this.records.find((record) => sameKey(record, input));
      if (other !== undefined && other.session.cwd !== cwd) throw new Error("Session link belongs to another workspace.");
      const current = this.get(input);
      if (current !== undefined) return current;
      const next: ActionRunRecord = { provider: "github", source: input.source, session: { id: input.id, cwd }, repo: input.repo, runId: input.runId, watch: { kind: "off" }, revision: 0 };
      await this.persist([...this.records, next]);
      return structuredClone(next);
    });
  }

  /** Removes a link and its watch. Returns the removed record, or undefined when it was not linked. */
  unlink(key: ActionRunKey): Promise<ActionRunRecord | undefined> {
    return this.exclusive(async () => {
      const current = this.get(key);
      if (current === undefined) return undefined;
      await this.persist(this.records.filter((record) => !sameKey(record, key)));
      return current;
    });
  }

  /** Compare-and-write invalidates every poll that began before Stop, unlink, or another update. */
  update(key: ActionRunKey, revision: number, change: (record: ActionRunRecord) => ActionRunRecord): Promise<ActionRunRecord | undefined> {
    return this.exclusive(async () => {
      const current = this.get(key);
      if (current?.revision !== revision) return undefined;
      const next = { ...change(current), revision: current.revision + 1 };
      if (!Check(RecordSchema, next) || !sameKey(next, key) || next.session.cwd !== current.session.cwd || next.source !== current.source) throw new Error("Invalid action run state update.");
      await this.persist(this.records.map((record) => sameKey(record, key) ? next : record));
      return structuredClone(next);
    });
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async persist(records: ActionRunRecord[]): Promise<void> {
    if (!Check(FileSchema, { version: VERSION, records })) throw new Error("Invalid action run state.");
    if (this.path !== undefined) {
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try { await writeFile(temp, `${JSON.stringify({ version: VERSION, records }, null, 2)}\n`, { mode: 0o600 }); await rename(temp, this.path); }
      finally { await rm(temp, { force: true }); }
    }
    this.records = structuredClone(records);
  }
}
