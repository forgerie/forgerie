import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { PullLinkSchema, type PullLink } from "../../shared/pullRequests.js";
import { canonicalizeStoredCwd } from "../workingDirectory.js";

export const WatchCursorSchema = Type.Object({ headSha: Type.String(), failed: Type.Array(Type.String()), passed: Type.Array(Type.String()), conflicting: Type.Boolean(), remarksThrough: Type.String(), remarkIds: Type.Array(Type.String()), commentWakes: Type.Integer({ minimum: 0 }) });
export type WatchCursor = Static<typeof WatchCursorSchema>;
const RecordSchema = Type.Intersect([PullLinkSchema, Type.Object({ revision: Type.Integer({ minimum: 0 }), startLeaf: Type.Optional(Type.Union([Type.String(), Type.Null()])), lastReadAt: Type.Optional(Type.String()), cursor: Type.Optional(WatchCursorSchema), pending: Type.Optional(Type.Object({ id: Type.String(), text: Type.String() })) })]);
export type PullRecord = Static<typeof RecordSchema>;
/** Version 1 held one record per session. Version 2 holds one per session and pull request; a version 1 file reads as is. */
const FileSchema = Type.Object({ version: Type.Union([Type.Literal(1), Type.Literal(2)]), records: Type.Array(RecordSchema) });
const VERSION = 2;

/** One session's link to one pull request. Repository names compare without case, as GitHub does. */
export interface PullKey { id: string; repo: string; number: number }
export const keyOf = (record: PullRecord): PullKey => ({ id: record.session.id, repo: record.repo, number: record.number });
const sameKey = (record: PullRecord, key: PullKey) => record.session.id === key.id && record.number === key.number && record.repo.toLowerCase() === key.repo.toLowerCase();
const keyText = (key: PullKey) => `${key.id}\n${key.repo.toLowerCase()}\n${String(key.number)}`;

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
    // v1/v2 files predate providers. Normalize only the missing field, then validate.
    if (typeof data === "object" && data !== null && "records" in data && Array.isArray(data.records)) {
      const records: unknown[] = data.records;
      for (const record of records) {
        if (typeof record === "object" && record !== null && !("provider" in record)) Object.assign(record, { provider: "github" });
      }
    }
    if (!Check(FileSchema, data)) throw new Error("Invalid pull request state file. Restore it before starting the daemon.");
    if (new Set(data.records.map((record) => keyText(keyOf(record)))).size !== data.records.length) throw new Error("Duplicate pull request session links.");
    this.records = data.records;
  }

  list(): PullRecord[] { return structuredClone(this.records); }
  /** A session's links, oldest first. */
  forSession(id: string): PullRecord[] { return structuredClone(this.records.filter((record) => record.session.id === id)); }
  get(key: PullKey): PullRecord | undefined { return structuredClone(this.records.find((record) => sameKey(record, key))); }
  /** Any of the session's pull requests is watched. */
  isWatching(id: string): boolean { return this.records.some((record) => record.session.id === id && record.watch.kind === "watching"); }

  /** Adds a link, or returns the existing one. Never replaces another pull request's link. */
  link(input: { id: string; cwd: string; repo: string; number: number; provider?: PullLink["provider"] }): Promise<PullRecord> {
    return this.exclusive(async () => {
      const cwd = canonicalizeStoredCwd(input.cwd);
      // A chat may link PRs from several owned workspaces. The workspace of an
      // existing PR link stays immutable; a different PR is an independent key.
      const other = this.records.find((record) => sameKey(record, input));
      if (other !== undefined && (other.session.cwd !== cwd || other.provider !== (input.provider ?? "github"))) throw new Error("Session link belongs to another workspace.");
      const current = this.get(input);
      if (current !== undefined) return current;
      const next: PullRecord = { provider: input.provider ?? "github", session: { id: input.id, cwd }, repo: input.repo, number: input.number, watch: { kind: "off" }, revision: 0 };
      await this.persist([...this.records, next]);
      return structuredClone(next);
    });
  }

  /** Removes a link and its watch. Returns the removed record, or undefined when it was not linked. */
  unlink(key: PullKey): Promise<PullRecord | undefined> {
    return this.exclusive(async () => {
      const current = this.get(key);
      if (current === undefined) return undefined;
      await this.persist(this.records.filter((record) => !sameKey(record, key)));
      return current;
    });
  }

  /** Compare-and-write invalidates every poll that began before Stop, unlink, or another update. */
  update(key: PullKey, revision: number, change: (record: PullRecord) => PullRecord): Promise<PullRecord | undefined> {
    return this.exclusive(async () => {
      const current = this.get(key);
      if (current?.revision !== revision) return undefined;
      const next = { ...change(current), revision: current.revision + 1 };
      if (!Check(RecordSchema, next) || !sameKey(next, key) || next.session.cwd !== current.session.cwd || next.provider !== current.provider) throw new Error("Invalid pull request state update.");
      await this.persist(this.records.map((record) => sameKey(record, key) ? next : record));
      return structuredClone(next);
    });
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async persist(records: PullRecord[]): Promise<void> {
    if (!Check(FileSchema, { version: VERSION, records })) throw new Error("Invalid pull request state.");
    if (this.path !== undefined) {
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try { await writeFile(temp, `${JSON.stringify({ version: VERSION, records }, null, 2)}\n`, { mode: 0o600 }); await rename(temp, this.path); }
      finally { await rm(temp, { force: true }); }
    }
    this.records = structuredClone(records);
  }
}
