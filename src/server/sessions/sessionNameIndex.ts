import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { open, readFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { piWebDataDir } from "../../config.js";

const SESSION_NAME_INDEX_VERSION = 1;
const SESSION_INFO_PREFIX = Buffer.from('{"type":"session_info"');
const NEWLINE = 0x0a;
const SCAN_CHUNK_BYTES = 64 * 1024;
const INITIAL_NAME_SCAN_BYTES = 64 * 1024;
const MAX_CONCURRENT_NAME_SCANS = 32;
const MAX_SESSION_INFO_LINE_BYTES = 16 * 1024;
const SESSION_NAME_INDEX_FILE_MODE = 0o600;

export type SessionNameState =
  | { readonly kind: "unknown" }
  | { readonly kind: "cleared" }
  | { readonly kind: "named"; readonly name: string };

interface SessionNameIndexEntry {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  readonly observedSize: number;
  readonly resumeOffset: number;
  readonly name: SessionNameState;
}

interface PersistedSessionNameIndex {
  readonly version: typeof SESSION_NAME_INDEX_VERSION;
  readonly entries: readonly SessionNameIndexEntry[];
}

export interface SessionNameIndexOptions {
  readonly filePath?: string;
  readonly onPersistenceError?: (operation: "load" | "save", error: unknown) => void;
}

/**
 * Durable name state for the bounded machine catalog.
 *
 * Unknown files start from a tail baseline so the first catalog request never
 * reads the whole session store. Opening or renaming a session records its live
 * name directly. After a baseline exists, later file growth is scanned from the
 * saved line boundary, so names appended by other Pi clients also survive a
 * daemon restart.
 */
export class SessionNameIndex {
  private readonly entries = new Map<string, SessionNameIndexEntry>();
  private readonly filePath: string | undefined;
  private readonly onPersistenceError: (operation: "load" | "save", error: unknown) => void;
  private loaded = false;
  private work: Promise<void> = Promise.resolve();

  constructor(options: SessionNameIndexOptions = {}) {
    this.filePath = options.filePath;
    this.onPersistenceError = options.onPersistenceError ?? (() => undefined);
  }

  namesFor(files: readonly string[]): Promise<ReadonlyMap<string, SessionNameState>> {
    return this.runExclusive(async () => {
      await this.load();
      // Keep entries for absent paths. A transient directory-read failure also
      // looks empty, while inode validation makes a retained stale entry safe.
      let changed = false;
      const verified = new Set<string>();
      const refreshedFiles = await mapWithConcurrency(files, MAX_CONCURRENT_NAME_SCANS, (file) => this.refreshFile(file));
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const refreshed = refreshedFiles[index];
        if (file === undefined || refreshed === undefined) continue;
        if (refreshed.changed) changed = true;
        if (refreshed.usable) verified.add(file);
      }
      if (changed) await this.save().catch(() => undefined);
      return new Map([...verified].flatMap((path) => {
        const entry = this.entries.get(path);
        return entry === undefined ? [] : [[path, entry.name] as const];
      }));
    });
  }

  remember(filePath: string, name: string | undefined): Promise<void> {
    return this.runExclusive(async () => {
      await this.load();
      const stats = await stat(filePath);
      this.entries.set(filePath, {
        path: filePath,
        dev: stats.dev,
        ino: stats.ino,
        observedSize: stats.size,
        resumeOffset: stats.size,
        name: name === undefined || name.trim() === "" ? clearedName() : named(name.trim()),
      });
      await this.save().catch(() => undefined);
    });
  }

  async flush(): Promise<void> {
    await this.work;
  }

  private runExclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.work.then(operation, operation);
    this.work = result.then(() => undefined, () => undefined);
    return result;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (this.filePath === undefined) return;
    let source: string;
    try {
      source = await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      this.reportPersistenceError("load", error);
      return;
    }
    try {
      const parsed = parsePersistedSessionNameIndex(JSON.parse(source));
      for (const entry of parsed.entries) this.entries.set(entry.path, entry);
    } catch (error: unknown) {
      this.entries.clear();
      this.reportPersistenceError("load", error);
    }
  }

  private async refreshFile(filePath: string): Promise<{ changed: boolean; usable: boolean }> {
    let pathStats: Stats;
    try {
      pathStats = await stat(filePath);
    } catch {
      return { changed: false, usable: false };
    }

    const cached = this.entries.get(filePath);
    if (cached?.dev === pathStats.dev
      && cached.ino === pathStats.ino
      && cached.observedSize === pathStats.size) {
      return { changed: false, usable: true };
    }

    const opened = await open(filePath, "r").catch(() => undefined);
    if (opened === undefined) return { changed: false, usable: false };
    try {
      const stats = await opened.stat();
      const cachedPrefixIsValid = cached?.dev === stats.dev
        && cached.ino === stats.ino
        && stats.size >= cached.observedSize;
      const startOffset = cachedPrefixIsValid
        ? cached.resumeOffset
        : Math.max(0, stats.size - INITIAL_NAME_SCAN_BYTES);
      const initialName = cachedPrefixIsValid ? cached.name : unknownName();
      const scanned = await scanSessionNames(opened, startOffset, initialName);
      this.entries.set(filePath, {
        path: filePath,
        dev: stats.dev,
        ino: stats.ino,
        observedSize: scanned.endOffset,
        resumeOffset: scanned.resumeOffset,
        name: scanned.name,
      });
      return { changed: true, usable: true };
    } catch {
      return { changed: false, usable: false };
    } finally {
      await opened.close().catch(() => undefined);
    }
  }

  private async save(): Promise<void> {
    if (this.filePath === undefined) return;
    const state: PersistedSessionNameIndex = {
      version: SESSION_NAME_INDEX_VERSION,
      entries: [...this.entries.values()],
    };
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tempPath = `${this.filePath}.${process.pid.toString()}-${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        mode: SESSION_NAME_INDEX_FILE_MODE,
        flag: "wx",
      });
      await rename(tempPath, this.filePath);
    } catch (error: unknown) {
      this.reportPersistenceError("save", error);
      throw error;
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private reportPersistenceError(operation: "load" | "save", error: unknown): void {
    try {
      this.onPersistenceError(operation, error);
    } catch {
      // Error reporting must not replace the persistence failure.
    }
  }
}

export function defaultSessionNameIndexFilePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return join(piWebDataDir(env, cwd), "session-names.json");
}

interface SessionNameScanResult {
  readonly endOffset: number;
  readonly resumeOffset: number;
  readonly name: SessionNameState;
}

async function scanSessionNames(
  file: Awaited<ReturnType<typeof open>>,
  startOffset: number,
  initialName: SessionNameState,
): Promise<SessionNameScanResult> {
  const chunk = Buffer.allocUnsafe(SCAN_CHUNK_BYTES);
  let position = startOffset;
  let resumeOffset = startOffset;
  let name = initialName;
  let line = createLineCandidate();

  for (;;) {
    const { bytesRead } = await file.read(chunk, 0, chunk.length, position);
    if (bytesRead === 0) return { endOffset: position, resumeOffset, name };
    const data = chunk.subarray(0, bytesRead);
    let segmentStart = 0;
    let newlineAt = data.indexOf(NEWLINE);
    while (newlineAt !== -1) {
      line.feed(data.subarray(segmentStart, newlineAt));
      const parsedName = line.finish();
      if (parsedName !== undefined) name = parsedName;
      resumeOffset = position + newlineAt + 1;
      line = createLineCandidate();
      segmentStart = newlineAt + 1;
      newlineAt = data.indexOf(NEWLINE, segmentStart);
    }
    if (segmentStart < data.length) line.feed(data.subarray(segmentStart));
    position += bytesRead;
  }
}

interface LineCandidate {
  feed(bytes: Buffer): void;
  finish(): SessionNameState | undefined;
}

function createLineCandidate(): LineCandidate {
  let mode: "unknown" | "session-info" | "skip" = "unknown";
  let prefix = Buffer.alloc(0);
  const parts: Buffer[] = [];
  let length = 0;

  return {
    feed(bytes) {
      if (bytes.length === 0 || mode === "skip") return;
      if (mode === "session-info") {
        append(bytes);
        return;
      }

      const needed = SESSION_INFO_PREFIX.length - prefix.length;
      const prefixPart = bytes.subarray(0, Math.min(needed, bytes.length));
      const candidate = prefix.length === 0 ? Buffer.from(prefixPart) : Buffer.concat([prefix, prefixPart]);
      if (!prefixMatches(candidate)) {
        mode = "skip";
        prefix = Buffer.alloc(0);
        return;
      }
      prefix = candidate;
      if (prefix.length < SESSION_INFO_PREFIX.length) return;

      mode = "session-info";
      append(prefix);
      append(bytes.subarray(prefixPart.length));
      prefix = Buffer.alloc(0);
    },
    finish() {
      if (mode !== "session-info") return undefined;
      const entry = parseObject(Buffer.concat(parts).toString("utf8"));
      if (entry?.["type"] !== "session_info") return undefined;
      const value = entry["name"];
      if (typeof value !== "string" || value.trim() === "") return clearedName();
      return named(value.trim());
    },
  };

  function append(bytes: Buffer): void {
    if (bytes.length === 0) return;
    length += bytes.length;
    if (length > MAX_SESSION_INFO_LINE_BYTES) {
      mode = "skip";
      parts.length = 0;
      return;
    }
    parts.push(Buffer.from(bytes));
  }
}

function prefixMatches(candidate: Buffer): boolean {
  return SESSION_INFO_PREFIX.subarray(0, candidate.length).equals(candidate);
}

function parsePersistedSessionNameIndex(value: unknown): PersistedSessionNameIndex {
  if (!isRecord(value) || value["version"] !== SESSION_NAME_INDEX_VERSION || !Array.isArray(value["entries"])) {
    throw new Error("Unsupported session name index format");
  }
  return {
    version: SESSION_NAME_INDEX_VERSION,
    entries: value["entries"].map(parsePersistedEntry),
  };
}

function parsePersistedEntry(value: unknown): SessionNameIndexEntry {
  if (!isRecord(value)) throw new Error("Invalid session name index entry");
  const path = value["path"];
  const dev = value["dev"];
  const ino = value["ino"];
  const observedSize = value["observedSize"];
  const resumeOffset = value["resumeOffset"];
  if (typeof path !== "string" || path === ""
    || !isNonNegativeInteger(dev)
    || !isNonNegativeInteger(ino)
    || !isNonNegativeInteger(observedSize)
    || !isNonNegativeInteger(resumeOffset)
    || resumeOffset > observedSize) {
    throw new Error("Invalid session name index entry metadata");
  }
  return { path, dev, ino, observedSize, resumeOffset, name: parseNameState(value["name"]) };
}

function parseNameState(value: unknown): SessionNameState {
  if (!isRecord(value)) throw new Error("Invalid session name state");
  if (value["kind"] === "unknown") return unknownName();
  if (value["kind"] === "cleared") return clearedName();
  if (value["kind"] === "named" && typeof value["name"] === "string" && value["name"].trim() !== "") return named(value["name"].trim());
  throw new Error("Invalid session name state");
}

function unknownName(): SessionNameState {
  return { kind: "unknown" };
}

function clearedName(): SessionNameState {
  return { kind: "cleared" };
}

function named(name: string): SessionNameState {
  return { kind: "named", name };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseObject(source: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(source);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  map: (input: Input) => Promise<Output>,
): Promise<(Output | undefined)[]> {
  const outputs: (Output | undefined)[] = Array.from({ length: inputs.length }, () => undefined);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    for (;;) {
      const index = nextIndex++;
      const input = inputs[index];
      if (input === undefined) return;
      outputs[index] = await map(input);
    }
  });
  await Promise.all(workers);
  return outputs;
}

export function indexedSessionName(state: SessionNameState | undefined): string | undefined {
  return state?.kind === "named" ? state.name : undefined;
}

export function indexedSessionNameIsAuthoritative(state: SessionNameState | undefined): boolean {
  return state !== undefined && state.kind !== "unknown";
}
