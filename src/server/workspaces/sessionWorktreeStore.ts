import { randomUUID, createHash } from "node:crypto";
import { access, chmod, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { SessionWorktreeRecordSchema, type SessionWorktreeRecord, type SessionWorktreeInfo } from "../../shared/sessionWorktree.js";
import { cwdPathsEqual } from "../workingDirectory.js";
import type { SessionInfo } from "../../shared/apiTypes.js";
import type { ArchivedSessionRecord } from "../sessions/sessionArchiveStore.js";
import { readSessionHeaderSummary } from "../sessions/sessionFileHeader.js";

const FileSchema = Type.Object({ version: Type.Literal(1), worktrees: Type.Array(SessionWorktreeRecordSchema) }, { additionalProperties: false });
interface SessionIdentity { id: string; cwd: string }
export type SessionWorktreeChanges = { [Key in keyof SessionWorktreeRecord]?: SessionWorktreeRecord[Key] | undefined };

/** Ownership is durable state, not a reconstructible cache. Invalid files fail closed. */
export class SessionWorktreeStore {
  private records: SessionWorktreeRecord[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath?: string) {}

  async initialize(archivedSessions: readonly ArchivedSessionRecord[] = []): Promise<void> {
    if (this.filePath === undefined) return;
    let source: string;
    try { source = await readFile(this.filePath, "utf8"); }
    catch (error) { if (isMissing(error)) return; throw error; }
    const data: unknown = JSON.parse(source);
    if (!Check(FileSchema, data)) throw new Error("Invalid session worktree ownership file");
    this.records = data.worktrees;
    // A killed setup cannot still be running. Preserve its log and offer retry.
    for (const record of await this.list()) {
      if (record.setup.phase !== "done" && record.setup.phase !== "failed") {
        await this.update(record.id, { setup: { ...record.setup, phase: "failed", error: "Session daemon restarted during setup" } });
      }
      if (record.state.kind === "active" && record.ownerSession !== undefined) {
        try { await access(record.ownerSession.path); }
        catch (error) {
          if (!isMissing(error)) throw error;
          // Archiving moves the transcript out of Pi's active directory. Its
          // absence there does not prove the first message was never saved.
          const archived = archivedSessions.find((session) => session.sessionId === record.sessionId && cwdPathsEqual(session.cwd, record.path));
          const header = archived?.archivePath === undefined ? undefined : await readSessionHeaderSummary(archived.archivePath);
          if (header === undefined || header.id !== record.sessionId || header.cwd === undefined || !cwdPathsEqual(header.cwd, record.path)) {
            await this.update(record.id, { sessionId: undefined, ownerSession: undefined,
              setup: { ...record.setup, phase: "failed", error: "Session daemon restarted before the first message was persisted. Retry this setup." } });
          }
        }
      }
      // Do not repeat destructive steps at startup. The next explicit action reconciles git state.
      if (record.operation !== undefined) await this.update(record.id, { operation: undefined });
    }
  }

  list(): Promise<SessionWorktreeRecord[]> { return Promise.resolve(structuredClone(this.records)); }
  require(id: string): Promise<SessionWorktreeRecord> {
    const record = this.records.find((item) => item.id === id);
    if (record === undefined) return Promise.reject(new Error("Session worktree not found"));
    return Promise.resolve(structuredClone(record));
  }
  async add(record: SessionWorktreeRecord): Promise<void> {
    await this.exclusive(async () => {
      if (this.records.some((item) => item.id === record.id)) throw new Error("Worktree ownership already exists");
      await this.persist([...this.records, structuredClone(record)]);
    });
  }
  async update(id: string, changes: SessionWorktreeChanges): Promise<SessionWorktreeRecord> {
    return this.exclusive(async () => {
      const existing = await this.require(id);
      const next = { ...existing, ...changes, updatedAt: new Date().toISOString() };
      if (next.operation === undefined) delete next.operation;
      if (next.pendingRename === undefined) delete next.pendingRename;
      if (next.sessionId === undefined) delete next.sessionId;
      if (next.ownerSession === undefined) delete next.ownerSession;
      if (!Check(SessionWorktreeRecordSchema, next)) throw new Error("Invalid session worktree record");
      await this.persist(this.records.map((item) => item.id === id ? next : item));
      return structuredClone(next);
    });
  }

  async forSession(ref: SessionIdentity): Promise<SessionWorktreeRecord | undefined> {
    return worktreeRecordForSession(await this.list(), ref);
  }
  async readOnly(ref: SessionIdentity): Promise<{ state: SessionWorktreeRecord["state"]; transcriptPath: string; session: SessionInfo } | undefined> {
    const record = await this.forSession(ref);
    if (record === undefined || record.state.kind === "active") return undefined;
    const transcript = record.transcripts.find((item) => item.id.startsWith(ref.id) && cwdPathsEqual(item.cwd, ref.cwd));
    if (transcript === undefined) throw new Error("Removed worktree session has no saved transcript");
    return { state: record.state, transcriptPath: transcript.transcriptPath, session: transcript.session };
  }
  async assertWritable(ref: SessionIdentity): Promise<void> {
    const records = await this.list();
    const removed = await this.readOnly(ref);
    if (removed !== undefined) throw new Error(`This session's worktree was ${removed.state.kind}. Its transcript is read-only.`);
    if (records.some((record) => record.operation !== undefined && pathInside(record.path, ref.cwd))) {
      throw new Error("A worktree lifecycle action is running. Wait before changing this session.");
    }
  }
  async saveTranscripts(id: string, sessions: readonly (Pick<SessionInfo, "id" | "cwd" | "path"> & Partial<SessionInfo> & { transcriptSourcePath?: string })[]): Promise<void> {
    const record = await this.require(id);
    const snapshots = [];
    for (const session of sessions.filter((session) => pathInside(record.path, session.cwd))) {
      const source = session.transcriptSourcePath ?? session.path;
      if (source === "") throw new Error("Cannot remove a worktree with an unpersisted session");
      const folder = this.filePath === undefined ? join(dirname(session.path), "worktree-transcripts", id) : join(dirname(this.filePath), "worktree-transcripts", id);
      await mkdir(folder, { recursive: true });
      const target = join(folder, `${createHash("sha256").update(session.id).digest("hex")}.jsonl`);
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await copyFile(source, temporary);
        await chmod(temporary, 0o600);
        await rename(temporary, target);
      } finally { await unlink(temporary).catch((error: unknown) => { if (!isMissing(error)) throw error; }); }
      snapshots.push({ id: session.id, cwd: session.cwd, transcriptPath: target, session: worktreeSessionMetadata(record, session) });
    }
    if (record.sessionId !== undefined && !snapshots.some((item) => item.id === record.sessionId)) {
      throw new Error("Cannot remove a worktree without its owner's persisted transcript");
    }
    await this.update(id, { transcripts: snapshots });
  }

  async forgetTranscripts(sessionIds: readonly string[]): Promise<void> {
    const ids = new Set(sessionIds);
    for (const record of await this.list()) {
      const removed = record.transcripts.filter((item) => ids.has(item.id));
      if (removed.length === 0) continue;
      await this.update(record.id, { transcripts: record.transcripts.filter((item) => !ids.has(item.id)) });
      for (const transcript of removed) await unlink(transcript.transcriptPath).catch((error: unknown) => { if (!isMissing(error)) throw error; });
    }
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release = (): void => undefined;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
  private async persist(records: SessionWorktreeRecord[]): Promise<void> {
    if (this.filePath !== undefined) {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, worktrees: records }), { mode: 0o600 });
        await rename(temporary, this.filePath);
      } finally { await unlink(temporary).catch((error: unknown) => { if (!isMissing(error)) throw error; }); }
    }
    this.records = structuredClone(records);
  }
}

export function worktreeRecordForSession(records: readonly SessionWorktreeRecord[], ref: SessionIdentity): SessionWorktreeRecord | undefined {
  return records.find((record) =>
    (record.sessionId?.startsWith(ref.id) === true && cwdPathsEqual(record.path, ref.cwd)) ||
    record.transcripts.some((transcript) => transcript.id.startsWith(ref.id) && cwdPathsEqual(transcript.cwd, ref.cwd)))
    ?? records.find((record) => record.state.kind === "active" && pathInside(record.path, ref.cwd));
}

export function worktreeSessionMetadata(record: SessionWorktreeRecord, session: Pick<SessionInfo, "id" | "cwd" | "path"> & Partial<SessionInfo>): SessionInfo {
  return {
    id: session.id, cwd: session.cwd, path: session.path,
    ...(session.name === undefined ? {} : { name: session.name }),
    ...(session.parentSessionPath === undefined ? {} : { parentSessionPath: session.parentSessionPath }),
    ...(session.agentSpawned === undefined ? {} : { agentSpawned: session.agentSpawned }),
    created: session.created ?? record.createdAt, modified: session.modified ?? record.updatedAt,
    messageCount: session.messageCount ?? 0, firstMessage: session.firstMessage ?? "",
  };
}

export function pathInside(root: string, path: string): boolean {
  const canonicalRoot = resolve(root);
  const canonicalPath = resolve(path);
  return canonicalPath === canonicalRoot || canonicalPath.startsWith(`${canonicalRoot.replace(/\/$/, "")}/`);
}
export function worktreeInfo(record: SessionWorktreeRecord, sessionId: string): SessionWorktreeInfo {
  return { id: record.id, owned: record.sessionId === sessionId, repo: record.repo, path: record.path, branch: record.branch, defaultBranch: record.defaultBranch, state: record.state, setup: record.setup, cleanup: record.cleanup, ...(record.archiveCleanup === undefined ? {} : { archiveCleanup: record.archiveCleanup }) };
}
function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
