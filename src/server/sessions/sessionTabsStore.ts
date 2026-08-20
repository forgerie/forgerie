import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { piWebDataDir } from "../../config.js";
import {
  SESSION_TABS_PER_SESSION_LIMIT,
  SESSION_TABS_SESSION_LIMIT,
  SESSION_TABS_TOOL_ID_MAX_LENGTH,
} from "../../shared/apiTypes.js";
import { canonicalizeStoredCwd } from "../workingDirectory.js";

export interface SessionTabsInput {
  sessionId: string;
  cwd: string;
  tabs: readonly string[];
}

export interface SessionTabsRecord {
  sessionId: string;
  cwd: string;
  /** Promoted tool ids in band order. Never empty: an empty set deletes the record. */
  tabs: string[];
  updatedAt: string;
}

export interface SessionTabsFile {
  sessions: SessionTabsRecord[];
}

export interface SessionTabsSetResult {
  /** The stored (deduplicated) tab set after the write. */
  tabs: string[];
  /** False when the write was a no-op, so callers can skip broadcasting. */
  changed: boolean;
}

export function defaultSessionTabsFilePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return join(piWebDataDir(env, cwd), "session-tabs.json");
}

/**
 * Catalog of per-session promoted tab sets.
 *
 * Follows the pin store's shape: keyed by session id, cwd kept for
 * reconciliation and always canonicalized, atomic JSON writes when a file
 * path is given, in-memory otherwise (the test default).
 *
 * Leftovers cannot accumulate by construction: an empty tab set deletes its
 * record, `reconcileCwd` drops records whose session no longer exists in its
 * workspace, and the catalog is capped at `SESSION_TABS_SESSION_LIMIT`
 * records with stalest-first eviction.
 */
export class SessionTabsStore {
  private operationQueue: Promise<void> = Promise.resolve();
  private cachedSnapshot: SessionTabsFile | undefined;

  constructor(
    private readonly filePath?: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<SessionTabsRecord[]> {
    return (await this.snapshot()).sessions.map(copyRecord);
  }

  async get(sessionId: string): Promise<SessionTabsRecord | undefined> {
    const record = (await this.snapshot()).sessions.find((session) => session.sessionId === sessionId);
    return record === undefined ? undefined : copyRecord(record);
  }

  /**
   * Replace one session's tab set. Idempotent: writing the stored set changes
   * nothing and keeps the record's age; an empty set deletes the record.
   */
  async set(input: SessionTabsInput): Promise<SessionTabsSetResult> {
    const tabs = requireTabs(input.tabs);
    const sessionId = requireNonEmptyString(input.sessionId, "sessionId");
    const cwd = canonicalizeStoredCwd(requireNonEmptyString(input.cwd, "cwd"));
    return this.exclusive(async () => {
      const data = await this.snapshot();
      const existing = data.sessions.find((session) => session.sessionId === sessionId);
      if (tabs.length === 0) {
        if (existing === undefined) return { tabs, changed: false };
        await this.persist({ sessions: data.sessions.filter((session) => session.sessionId !== sessionId) });
        return { tabs, changed: true };
      }
      if (existing !== undefined) {
        if (existing.cwd === cwd && sameTabs(existing.tabs, tabs)) return { tabs, changed: false };
      }
      const record: SessionTabsRecord = { sessionId, cwd, tabs, updatedAt: this.now().toISOString() };
      const retained = data.sessions.filter((session) => session.sessionId !== sessionId);
      await this.persist({ sessions: evictStalest([...retained, record]) });
      return { tabs, changed: true };
    });
  }

  /** Drop records for sessions that no longer exist in this cwd. Returns removed session ids. */
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

  private async snapshot(): Promise<SessionTabsFile> {
    if (this.cachedSnapshot !== undefined) return this.cachedSnapshot;
    const snapshot = this.filePath === undefined ? { sessions: [] } : await this.readFromDisk(this.filePath);
    this.cachedSnapshot = snapshot;
    return snapshot;
  }

  /**
   * A corrupt or invalid file is treated as empty rather than thrown, unlike
   * the pin store: tab state is a rendering preference, and a rotten file
   * must never take session listings down with it. The next write repairs it.
   */
  private async readFromDisk(filePath: string): Promise<SessionTabsFile> {
    let source: string;
    try {
      source = await readFile(filePath, "utf8");
    } catch (error: unknown) {
      if (isNodeErrorWithCode(error, "ENOENT")) return { sessions: [] };
      throw error;
    }
    try {
      return parseSessionTabsFile(JSON.parse(source));
    } catch {
      return { sessions: [] };
    }
  }

  private async persist(data: SessionTabsFile): Promise<void> {
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
    this.cachedSnapshot = { sessions: data.sessions.map(copyRecord) };
  }
}

export function parseSessionTabsFile(value: unknown): SessionTabsFile {
  if (!isRecord(value) || !Array.isArray(value["sessions"])) throw new Error("Invalid session tabs file");
  const sessions = value["sessions"].map(parseSessionTabsRecord);
  const seen = new Set<string>();
  for (const session of sessions) {
    if (seen.has(session.sessionId)) throw new Error("Duplicate session tabs id");
    seen.add(session.sessionId);
  }
  return { sessions: evictStalest(sessions) };
}

/** Drop the least recently updated records beyond the catalog cap. */
function evictStalest(sessions: readonly SessionTabsRecord[]): SessionTabsRecord[] {
  if (sessions.length <= SESSION_TABS_SESSION_LIMIT) return [...sessions];
  const byAge = [...sessions].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  const evicted = new Set(byAge.slice(0, sessions.length - SESSION_TABS_SESSION_LIMIT));
  return sessions.filter((session) => !evicted.has(session));
}

function parseSessionTabsRecord(value: unknown): SessionTabsRecord {
  if (!isRecord(value)) throw new Error("Invalid session tabs record");
  const sessionId = value["sessionId"];
  const cwd = value["cwd"];
  const updatedAt = value["updatedAt"];
  if (typeof sessionId !== "string" || sessionId === "") throw new Error("Invalid session tabs record");
  if (typeof cwd !== "string" || cwd === "") throw new Error("Invalid session tabs record");
  if (typeof updatedAt !== "string" || updatedAt === "") throw new Error("Invalid session tabs record");
  const tabs = requireTabs(value["tabs"]);
  if (tabs.length === 0) throw new Error("Invalid session tabs record");
  return { sessionId, cwd: canonicalizeStoredCwd(cwd), tabs, updatedAt };
}

function requireTabs(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("tabs must be an array");
  if (value.length > SESSION_TABS_PER_SESSION_LIMIT) throw new Error("tabs exceeds its limit");
  const tabs: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry === "") throw new Error("tabs entries must be non-empty strings");
    if (entry.length > SESSION_TABS_TOOL_ID_MAX_LENGTH) throw new Error("tabs entry is too long");
    if (!tabs.includes(entry)) tabs.push(entry);
  }
  return tabs;
}

function sameTabs(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function copyRecord(record: SessionTabsRecord): SessionTabsRecord {
  return { ...record, tabs: [...record.tabs] };
}

function requireNonEmptyString(value: string, field: string): string {
  if (value === "") throw new Error(`${field} must not be empty`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
