import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { piWebDataDir } from "../../config.js";
import { canonicalizeStoredCwd } from "../workingDirectory.js";
import { boundSessionCatalogFirstMessage } from "./sessionCatalogMetadata.js";

export interface ArchiveSessionInput {
  sessionId: string;
  cwd: string;
  path: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  name?: string;
  parentSessionPath?: string;
}

export interface ArchivedSessionRecord {
  sessionId: string;
  cwd: string;
  archivedAt: string;
  originalPath?: string;
  archivePath?: string;
  created?: string;
  modified?: string;
  messageCount?: number;
  firstMessage?: string;
  name?: string;
  parentSessionPath?: string;
}

export interface SessionArchiveFile {
  sessions: ArchivedSessionRecord[];
}

export type SessionArchiveInitializationResult =
  | { status: "ready"; compacted: boolean }
  | { status: "degraded"; compacted: false; error: unknown };

export function defaultSessionArchiveFilePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return join(piWebDataDir(env, cwd), "archived-sessions.json");
}

export class SessionArchiveStore {
  private operationQueue: Promise<void> = Promise.resolve();
  private initializationPromise: Promise<SessionArchiveInitializationResult> | undefined;
  private cachedSnapshot: SessionArchiveFile | undefined;

  constructor(
    private readonly filePath = defaultSessionArchiveFilePath(),
    private readonly archiveDir = join(dirname(filePath), "archived-sessions"),
  ) {}

  initialize(): Promise<SessionArchiveInitializationResult> {
    if (this.initializationPromise !== undefined) return this.initializationPromise;
    const initializationPromise = this.loadAndCompact();
    this.initializationPromise = initializationPromise;
    return initializationPromise;
  }

  async list(): Promise<ArchivedSessionRecord[]> {
    return cloneArchiveFile(await this.snapshot()).sessions;
  }

  async get(sessionId: string): Promise<ArchivedSessionRecord | undefined> {
    const sessions = (await this.snapshot()).sessions;
    const record = sessions.find((session) => session.sessionId === sessionId) ?? sessions.find((session) => session.sessionId.startsWith(sessionId));
    return record === undefined ? undefined : { ...record };
  }

  async archive(session: ArchiveSessionInput): Promise<ArchivedSessionRecord> {
    const [record] = await this.archiveMany([session]);
    if (record === undefined) throw new Error("Archive operation did not produce a record");
    return record;
  }

  async archiveMany(sessions: readonly ArchiveSessionInput[]): Promise<ArchivedSessionRecord[]> {
    if (sessions.length === 0) return [];
    return this.exclusive(async () => {
      const data = cloneArchiveFile(await this.snapshot());
      const records: ArchivedSessionRecord[] = [];
      const filesToRemove: { source: string; archivePath: string }[] = [];

      for (const session of sessions) {
        const existingIndex = data.sessions.findIndex((record) => record.sessionId === session.sessionId);
        const existing = existingIndex === -1 ? undefined : data.sessions[existingIndex];
        const archivePath = existing?.archivePath ?? this.archivePathFor(session);
        const record = archiveRecordFromInput(session, {
          archivedAt: existing?.archivedAt ?? new Date().toISOString(),
          originalPath: existing?.originalPath ?? session.path,
          archivePath,
        });

        await copySessionFileToArchive(session.path, archivePath);

        if (existingIndex === -1) data.sessions.push(record);
        else data.sessions[existingIndex] = record;
        records.push(record);
        filesToRemove.push({ source: session.path, archivePath });
      }

      await this.persistAndPublish(data);
      for (const file of filesToRemove) await removeActiveSessionFile(file.source, file.archivePath);
      return records;
    });
  }

  async restore(sessionId: string): Promise<void> {
    await this.exclusive(async () => {
      const data = cloneArchiveFile(await this.snapshot());
      const record = data.sessions.find((session) => session.sessionId === sessionId);
      if (record === undefined) return;

      if (record.archivePath !== undefined && record.originalPath !== undefined) {
        await restoreSessionFile(record.archivePath, record.originalPath);
      }

      const sessions = data.sessions.filter((session) => session.sessionId !== sessionId);
      await this.persistAndPublish({ sessions });
    });
  }

  async deleteArchived(sessionId: string): Promise<void> {
    await this.deleteArchivedMany([sessionId]);
  }

  async deleteArchivedMany(sessionIds: readonly string[]): Promise<string[]> {
    const targetIds = uniqueStrings(sessionIds);
    if (targetIds.length === 0) return [];
    return this.exclusive(async () => {
      const data = cloneArchiveFile(await this.snapshot());
      const targetIdSet = new Set(targetIds);
      const records = data.sessions.filter((session) => targetIdSet.has(session.sessionId));
      if (records.length === 0) return [];

      for (const record of records) {
        if (record.archivePath !== undefined && await pathExists(record.archivePath)) await unlink(record.archivePath);
      }
      const sessions = data.sessions.filter((session) => !targetIdSet.has(session.sessionId));
      await this.persistAndPublish({ sessions });
      const deletedIds = new Set(records.map((record) => record.sessionId));
      return targetIds.filter((sessionId) => deletedIds.has(sessionId));
    });
  }

  async isArchived(sessionId: string): Promise<boolean> {
    return (await this.get(sessionId)) !== undefined;
  }

  private archivePathFor(session: ArchiveSessionInput): string {
    const sourceName = basename(session.path);
    const fileName = sourceName === "" ? `${safeFileName(session.sessionId)}.jsonl` : sourceName;
    return join(this.archiveDir, fileName);
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

  private async snapshot(): Promise<SessionArchiveFile> {
    await this.initialize();
    if (this.cachedSnapshot === undefined) throw new Error("Session archive store initialization did not publish a snapshot");
    return this.cachedSnapshot;
  }

  private async loadAndCompact(): Promise<SessionArchiveInitializationResult> {
    const diskDocument = await this.readFromDisk();
    const normalized = normalizeArchiveDocument(diskDocument);
    if (!normalized.changed) {
      this.cachedSnapshot = cloneArchiveFile(normalized.data);
      return { status: "ready", compacted: false };
    }

    try {
      await this.write(normalized.document);
      this.cachedSnapshot = cloneArchiveFile(normalized.data);
      return { status: "ready", compacted: true };
    } catch (error: unknown) {
      // The atomic replacement failed, so keep serving the parsed disk state.
      // Transport mapping still applies the catalog bound until persistence recovers.
      this.cachedSnapshot = cloneArchiveFile(parseSessionArchiveFile(diskDocument));
      return { status: "degraded", compacted: false, error };
    }
  }

  private async readFromDisk(): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error: unknown) {
      if (isNodeErrorWithCode(error, "ENOENT")) return { sessions: [] };
      throw error;
    }
  }

  private async persistAndPublish(data: SessionArchiveFile): Promise<void> {
    const normalized = normalizeArchiveFile(data).data;
    await this.write(normalized);
    this.cachedSnapshot = cloneArchiveFile(normalized);
  }

  private async write(data: unknown): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = join(dirname(this.filePath), `.${basename(this.filePath)}.${String(process.pid)}.${Date.now().toString()}.${randomUUID()}.tmp`);
    try {
      await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await rename(tempPath, this.filePath);
    } catch (error: unknown) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }
}

function normalizeArchiveDocument(document: unknown): { document: unknown; data: SessionArchiveFile; changed: boolean } {
  const data = parseSessionArchiveFile(document);
  if (!isRecord(document) || !Array.isArray(document["sessions"])) throw new Error("Invalid archive file");

  const rawSessions = document["sessions"];
  const sessions = rawSessions.map((record) => {
    if (!isRecord(record)) throw new Error("Invalid archived session record");
    const firstMessage = record["firstMessage"];
    if (typeof firstMessage !== "string") return record;
    const boundedFirstMessage = boundSessionCatalogFirstMessage(firstMessage);
    return boundedFirstMessage === firstMessage ? record : { ...record, firstMessage: boundedFirstMessage };
  });
  const changed = sessions.some((record, index) => record !== rawSessions[index]);
  if (!changed) return { document, data, changed: false };

  const normalizedDocument = { ...document, sessions };
  return { document: normalizedDocument, data: parseSessionArchiveFile(normalizedDocument), changed: true };
}

function normalizeArchiveFile(data: SessionArchiveFile): { data: SessionArchiveFile; changed: boolean } {
  let changed = false;
  const sessions = data.sessions.map((record) => {
    if (record.firstMessage === undefined) return { ...record };
    const firstMessage = boundSessionCatalogFirstMessage(record.firstMessage);
    if (firstMessage === record.firstMessage) return { ...record };
    changed = true;
    return { ...record, firstMessage };
  });
  return { data: { sessions }, changed };
}

function cloneArchiveFile(data: SessionArchiveFile): SessionArchiveFile {
  return { sessions: data.sessions.map((record) => ({ ...record })) };
}

function archiveRecordFromInput(session: ArchiveSessionInput, archive: { archivedAt: string; originalPath: string; archivePath: string }): ArchivedSessionRecord {
  return {
    sessionId: session.sessionId,
    cwd: canonicalizeStoredCwd(session.cwd),
    archivedAt: archive.archivedAt,
    originalPath: archive.originalPath,
    archivePath: archive.archivePath,
    created: session.created,
    modified: session.modified,
    messageCount: session.messageCount,
    firstMessage: boundSessionCatalogFirstMessage(session.firstMessage),
    ...(session.name === undefined ? {} : { name: session.name }),
    ...(session.parentSessionPath === undefined ? {} : { parentSessionPath: session.parentSessionPath }),
  };
}

async function copySessionFileToArchive(source: string, archivePath: string): Promise<void> {
  if (source === archivePath) return;
  await mkdir(dirname(archivePath), { recursive: true });
  if (await pathExists(archivePath)) return;
  await copyFile(source, archivePath);
}

async function removeActiveSessionFile(source: string, archivePath: string): Promise<void> {
  if (source === archivePath) return;
  if (await pathExists(source)) await unlink(source);
}

async function restoreSessionFile(archivePath: string, originalPath: string): Promise<void> {
  if (archivePath === originalPath) return;
  if (await pathExists(originalPath)) throw new Error(`Cannot restore archived session because a session already exists at ${originalPath}`);
  await mkdir(dirname(originalPath), { recursive: true });
  await moveFile(archivePath, originalPath);
}

async function moveFile(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination);
  } catch (error: unknown) {
    if (!isNodeErrorWithCode(error, "EXDEV")) throw error;
    await copyFile(source, destination);
    await unlink(source);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error, "ENOENT")) return false;
    throw error;
  }
}

export function parseSessionArchiveFile(value: unknown): SessionArchiveFile {
  if (!isRecord(value) || !Array.isArray(value["sessions"])) throw new Error("Invalid archive file");
  return { sessions: value["sessions"].map(parseArchivedSessionRecord) };
}

function parseArchivedSessionRecord(value: unknown): ArchivedSessionRecord {
  if (!isRecord(value)) throw new Error("Invalid archived session record");
  const sessionId = value["sessionId"];
  const cwd = value["cwd"];
  const archivedAt = value["archivedAt"];
  if (typeof sessionId !== "string" || typeof cwd !== "string" || typeof archivedAt !== "string") throw new Error("Invalid archived session record");
  const canonicalCwd = canonicalizeStoredCwd(cwd);
  const originalPath = optionalString(value, "originalPath");
  const archivePath = optionalString(value, "archivePath");
  const created = optionalString(value, "created");
  const modified = optionalString(value, "modified");
  const messageCount = optionalNumber(value, "messageCount");
  const firstMessage = optionalString(value, "firstMessage");
  const name = optionalString(value, "name");
  const parentSessionPath = optionalString(value, "parentSessionPath");
  return {
    sessionId,
    cwd: canonicalCwd,
    archivedAt,
    ...(originalPath === undefined ? {} : { originalPath }),
    ...(archivePath === undefined ? {} : { archivePath }),
    ...(created === undefined ? {} : { created }),
    ...(modified === undefined ? {} : { modified }),
    ...(messageCount === undefined ? {} : { messageCount }),
    ...(firstMessage === undefined ? {} : { firstMessage }),
    ...(name === undefined ? {} : { name }),
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
  };
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Invalid archived session record");
  return value;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number") throw new Error("Invalid archived session record");
  return value;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_") || "session";
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
