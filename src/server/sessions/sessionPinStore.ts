import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { piWebDataDir } from "../../config.js";
import { canonicalizeStoredCwd } from "../workingDirectory.js";

export interface PinSessionInput {
  sessionId: string;
  cwd: string;
}

export interface PinnedSessionRecord {
  sessionId: string;
  cwd: string;
  pinnedAt: string;
}

export interface SessionPinFile {
  sessions: PinnedSessionRecord[];
}

export function defaultSessionPinFilePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return join(piWebDataDir(env, cwd), "pinned-sessions.json");
}

/**
 * Catalog of pinned sessions.
 *
 * Pins are the server-owned invariant behind "a pinned session can never be
 * archived": every archive path consults this store before acting, and the
 * flag is merged into session listings so all browsers agree on it.
 *
 * A pin is keyed by session id; the cwd is kept for reconciliation (a session
 * file that disappears from its workspace takes its pin with it) and display.
 * Archived sessions are never pinned — pinning rejects them upstream — so the
 * store itself stays a flat, order-free set.
 *
 * Constructed with a file path the store is durable (atomic JSON writes);
 * without one it is in-memory, the default for tests. Production wiring
 * (sessiond) passes `defaultSessionPinFilePath()` explicitly.
 */
export class SessionPinStore {
  private operationQueue: Promise<void> = Promise.resolve();
  private cachedSnapshot: SessionPinFile | undefined;

  constructor(private readonly filePath?: string) {}

  async list(): Promise<PinnedSessionRecord[]> {
    return (await this.snapshot()).sessions.map((record) => ({ ...record }));
  }

  async get(sessionId: string): Promise<PinnedSessionRecord | undefined> {
    const sessions = (await this.snapshot()).sessions;
    const record = sessions.find((session) => session.sessionId === sessionId)
      ?? sessions.find((session) => session.sessionId.startsWith(sessionId));
    return record === undefined ? undefined : { ...record };
  }

  async isPinned(sessionId: string): Promise<boolean> {
    return (await this.snapshot()).sessions.some((session) => session.sessionId === sessionId);
  }

  /** Idempotent: pinning an already pinned session keeps its original pinnedAt. */
  async pin(input: PinSessionInput): Promise<PinnedSessionRecord> {
    return this.exclusive(async () => {
      const data = await this.snapshot();
      const existing = data.sessions.find((session) => session.sessionId === input.sessionId);
      if (existing !== undefined) return { ...existing };
      const record: PinnedSessionRecord = {
        sessionId: input.sessionId,
        cwd: canonicalizeStoredCwd(input.cwd),
        pinnedAt: new Date().toISOString(),
      };
      await this.persist({ sessions: [...data.sessions, record] });
      return { ...record };
    });
  }

  /** Idempotent: unpinning an unknown session is a no-op. Returns whether a pin was removed. */
  async unpin(sessionId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const data = await this.snapshot();
      const sessions = data.sessions.filter((session) => session.sessionId !== sessionId);
      if (sessions.length === data.sessions.length) return false;
      await this.persist({ sessions });
      return true;
    });
  }

  /** Drop pins for sessions that no longer exist in this cwd. Returns removed session ids. */
  async reconcileCwd(cwd: string, existingSessionIds: Iterable<string>): Promise<string[]> {
    const canonicalCwd = canonicalizeStoredCwd(cwd);
    const retained = new Set(existingSessionIds);
    return this.exclusive(async () => {
      const data = await this.snapshot();
      const removed = data.sessions
        .filter((session) => session.cwd === canonicalCwd && !retained.has(session.sessionId))
        .map((session) => session.sessionId);
      if (removed.length === 0) return [];
      const removedSet = new Set(removed);
      await this.persist({ sessions: data.sessions.filter((session) => !removedSet.has(session.sessionId)) });
      return removed;
    });
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationQueue;
    let release = (): void => undefined;
    this.operationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async snapshot(): Promise<SessionPinFile> {
    if (this.cachedSnapshot !== undefined) return this.cachedSnapshot;
    const snapshot = this.filePath === undefined ? { sessions: [] } : await this.readFromDisk(this.filePath);
    this.cachedSnapshot = snapshot;
    return snapshot;
  }

  private async readFromDisk(filePath: string): Promise<SessionPinFile> {
    let source: string;
    try {
      source = await readFile(filePath, "utf8");
    } catch (error: unknown) {
      if (isNodeErrorWithCode(error, "ENOENT")) return { sessions: [] };
      throw error;
    }
    return parseSessionPinFile(JSON.parse(source));
  }

  private async persist(data: SessionPinFile): Promise<void> {
    const filePath = this.filePath;
    if (filePath !== undefined) {
      await mkdir(dirname(filePath), { recursive: true });
      const tempPath = join(dirname(filePath), `.${basename(filePath)}.${String(process.pid)}.${randomUUID()}.tmp`);
      try {
        await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
        await rename(tempPath, filePath);
      } catch (error: unknown) {
        await unlink(tempPath).catch(() => undefined);
        throw error;
      }
    }
    this.cachedSnapshot = { sessions: data.sessions.map((record) => ({ ...record })) };
  }
}

export function parseSessionPinFile(value: unknown): SessionPinFile {
  if (!isRecord(value) || !Array.isArray(value["sessions"])) throw new Error("Invalid pinned sessions file");
  const sessions = value["sessions"].map(parsePinnedSessionRecord);
  const seen = new Set<string>();
  for (const session of sessions) {
    if (seen.has(session.sessionId)) throw new Error("Duplicate pinned session id");
    seen.add(session.sessionId);
  }
  return { sessions };
}

function parsePinnedSessionRecord(value: unknown): PinnedSessionRecord {
  if (!isRecord(value)) throw new Error("Invalid pinned session record");
  const sessionId = value["sessionId"];
  const cwd = value["cwd"];
  const pinnedAt = value["pinnedAt"];
  if (typeof sessionId !== "string" || sessionId === "") throw new Error("Invalid pinned session record");
  if (typeof cwd !== "string" || cwd === "") throw new Error("Invalid pinned session record");
  if (typeof pinnedAt !== "string" || pinnedAt === "") throw new Error("Invalid pinned session record");
  return { sessionId, cwd: canonicalizeStoredCwd(cwd), pinnedAt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
