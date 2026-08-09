import type { Dirent, Stats } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import type { PiSessionListEntry } from "./piSessionService.js";

const CATALOG_WINDOW_BYTES = 64 * 1024;
const CATALOG_FIRST_MESSAGE_MAX_CHARS = 500;
const MAX_CONCURRENT_CATALOG_READS = 32;

interface CachedCatalogEntry {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  entry?: PiSessionListEntry;
}

/**
 * A machine-inbox scanner deliberately bounded by metadata windows.
 *
 * Full Pi listings parse every transcript entry. That is appropriate for
 * cleanup, but a machine can retain tens of gigabytes of transcripts and the
 * navigation catalog only needs identity, location, dates, and a useful title.
 * This scanner reads at most 64 KiB from each end of a file, then memoizes the
 * result by file identity/size/mtime. The prefix contains the immutable session
 * header and normally the first user prompt; the suffix captures later renames.
 * `messageCount` is therefore an occupancy marker/lower bound in this catalog,
 * not the transcript's exact count. First-message text is capped because it is
 * used only as a row title and historical prompts can contain megabytes of
 * injected context. No inbox behavior depends on the complete values.
 */
export class SessionCatalogScanner {
  private readonly memo = new Map<string, CachedCatalogEntry>();

  async scanDirectories(sessionDirs: readonly string[]): Promise<PiSessionListEntry[]> {
    const filesByDir = await Promise.all(sessionDirs.map(async (dir) => ({ dir, files: await listSessionFiles(dir) })));
    for (const { dir, files } of filesByDir) this.pruneDirectory(dir, files);
    const files = [...new Set(filesByDir.flatMap(({ files }) => files))];
    const entries = await mapWithConcurrency(files, MAX_CONCURRENT_CATALOG_READS, (file) => this.scanFile(file));
    return entries.filter(isDefined).sort((a, b) => b.modified.getTime() - a.modified.getTime());
  }

  private pruneDirectory(sessionDir: string, existingFiles: readonly string[]): void {
    const prefix = sessionDir.endsWith(sep) ? sessionDir : sessionDir + sep;
    const existing = new Set(existingFiles);
    for (const path of this.memo.keys()) {
      if (path.startsWith(prefix) && !existing.has(path)) this.memo.delete(path);
    }
  }

  private async scanFile(filePath: string): Promise<PiSessionListEntry | undefined> {
    let stats: Stats;
    try {
      stats = await stat(filePath);
    } catch {
      this.memo.delete(filePath);
      return undefined;
    }

    const cached = this.memo.get(filePath);
    if (cached?.dev === stats.dev
      && cached.ino === stats.ino
      && cached.size === stats.size
      && cached.mtimeMs === stats.mtimeMs) {
      return cached.entry;
    }

    const entry = await readCatalogEntry(filePath, stats);
    this.memo.set(filePath, {
      dev: stats.dev,
      ino: stats.ino,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      ...(entry === undefined ? {} : { entry }),
    });
    return entry;
  }
}

async function readCatalogEntry(filePath: string, stats: Stats): Promise<PiSessionListEntry | undefined> {
  let file;
  try {
    file = await open(filePath, "r");
  } catch {
    return undefined;
  }

  try {
    const prefixLength = Math.min(CATALOG_WINDOW_BYTES, stats.size);
    const prefixBuffer = Buffer.allocUnsafe(prefixLength);
    const prefixRead = await file.read(prefixBuffer, 0, prefixLength, 0);
    const prefix = completeLines(prefixBuffer.subarray(0, prefixRead.bytesRead), prefixRead.bytesRead === stats.size);
    const parsed = parsePrefix(prefix);
    if (parsed === undefined) return undefined;

    let suffixName: string | undefined;
    let suffixMessageCount = 0;
    if (stats.size > CATALOG_WINDOW_BYTES) {
      const suffixStart = Math.max(prefixRead.bytesRead, stats.size - CATALOG_WINDOW_BYTES);
      const suffixLength = stats.size - suffixStart;
      if (suffixLength > 0) {
        const suffixBuffer = Buffer.allocUnsafe(suffixLength);
        const suffixRead = await file.read(suffixBuffer, 0, suffixLength, suffixStart);
        const suffix = completeLinesFromOffset(suffixBuffer.subarray(0, suffixRead.bytesRead), suffixStart === 0);
        const suffixMetadata = parseMetadataLines(suffix);
        suffixName = suffixMetadata.name;
        suffixMessageCount = suffixMetadata.messageCount;
      }
    }

    const created = validDate(parsed.timestamp)
      ?? validDate(stats.birthtime)
      ?? stats.mtime;
    return {
      id: parsed.id,
      path: filePath,
      cwd: parsed.cwd,
      created,
      modified: stats.mtime,
      messageCount: parsed.messageCount + suffixMessageCount,
      firstMessage: parsed.firstMessage,
      allMessagesText: "",
      ...((suffixName ?? parsed.name) === undefined ? {} : { name: suffixName ?? parsed.name }),
      ...(parsed.parentSessionPath === undefined ? {} : { parentSessionPath: parsed.parentSessionPath }),
    };
  } catch {
    return undefined;
  } finally {
    await file.close();
  }
}

interface PrefixMetadata {
  id: string;
  cwd: string;
  timestamp?: string;
  parentSessionPath?: string;
  firstMessage: string;
  name?: string;
  messageCount: number;
}

function parsePrefix(lines: readonly string[]): PrefixMetadata | undefined {
  let header: Record<string, unknown> | undefined;
  let headerId: string | undefined;
  let headerIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseObject(lines[index] ?? "");
    if (parsed === undefined) continue;
    const id = parsed["id"];
    if (parsed["type"] !== "session" || typeof id !== "string" || id === "") return undefined;
    header = parsed;
    headerId = id;
    headerIndex = index;
    break;
  }
  if (header === undefined || headerId === undefined) return undefined;

  const metadata = parseMetadataLines(lines.slice(headerIndex + 1));
  return {
    id: headerId,
    cwd: typeof header["cwd"] === "string" ? header["cwd"] : "",
    ...(typeof header["timestamp"] === "string" ? { timestamp: header["timestamp"] } : {}),
    ...(typeof header["parentSession"] === "string" && header["parentSession"] !== ""
      ? { parentSessionPath: header["parentSession"] }
      : {}),
    firstMessage: metadata.firstMessage,
    ...(metadata.name === undefined ? {} : { name: metadata.name }),
    messageCount: metadata.messageCount,
  };
}

function parseMetadataLines(lines: readonly string[]): { firstMessage: string; name?: string; messageCount: number } {
  let firstMessage = "";
  let name: string | undefined;
  let messageCount = 0;
  for (const line of lines) {
    const entry = parseObject(line);
    if (entry === undefined) continue;
    if (entry["type"] === "session_info" && typeof entry["name"] === "string" && entry["name"].trim() !== "") {
      name = entry["name"].trim();
    }
    if (entry["type"] !== "message") continue;
    messageCount += 1;
    if (firstMessage !== "") continue;
    const message = objectField(entry, "message");
    if (message?.["role"] !== "user") continue;
    firstMessage = messageText(message["content"]);
  }
  return { firstMessage, ...(name === undefined ? {} : { name }), messageCount };
}

function messageText(content: unknown): string {
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
        .flatMap((part) => {
          if (typeof part === "string") return [part];
          if (!isUnknownRecord(part)) return [];
          const value = part["text"];
          return typeof value === "string" ? [value] : [];
        })
        .join("\n")
      : "";
  return Array.from(text.trim()).slice(0, CATALOG_FIRST_MESSAGE_MAX_CHARS).join("");
}

function completeLines(buffer: Buffer, endsAtEof: boolean): string[] {
  const lines = buffer.toString("utf8").split("\n");
  if (!endsAtEof) lines.pop();
  return lines;
}

function completeLinesFromOffset(buffer: Buffer, startsAtBeginning: boolean): string[] {
  const lines = buffer.toString("utf8").split("\n");
  if (!startsAtBeginning) lines.shift();
  return lines;
}

function parseObject(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return isUnknownRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function objectField(object: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = object[key];
  return isUnknownRecord(value) ? value : undefined;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: Date | string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function listSessionFiles(sessionDir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(sessionDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => join(sessionDir, entry.name));
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  map: (input: Input) => Promise<Output | undefined>,
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

function isDefined<Value>(value: Value | undefined): value is Value {
  return value !== undefined;
}
