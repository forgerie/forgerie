import { BrowserFileAccess, openBrowserFile } from "../browserFileAccess.js";
import { chmod, mkdir, open, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SessionSearchIndexStatus, SessionSearchMatch } from "../../shared/sessionSearch.js";
import { extractSearchMessage, parseSearchQuery, searchPassage, searchRecord, type SearchMessage } from "./sessionSearchText.js";

const SCHEMA_VERSION = 1;
const EXTRACTION_VERSION = 1;

export interface IndexedSearchHit {
  sessionId: string;
  passage: ReturnType<typeof searchPassage>;
  otherMatches: number;
  offBranch: boolean;
}

interface SearchFile {
  path: string;
  sessionId: string;
  dev: number;
  ino: number;
  size: number;
  mtime: number;
  child: boolean;
}

interface MessageRow extends SearchMessage { sessionId: string }

export interface SessionSearchIndexOptions {
  filePath: string;
  sessionsDir: string;
  agentDir?: string;
  log: (message: string) => void;
  onProgress?: (status: SessionSearchIndexStatus) => void;
}

/** The worker alone owns this connection. Source transcripts are opened with "r". */
export class SessionSearchIndex {
  private readonly browserFiles: BrowserFileAccess | undefined;
  private readonly db: DatabaseSync;
  private readonly queryDb: DatabaseSync;
  private discovery: Promise<void> = Promise.resolve();
  private status: SessionSearchIndexStatus = { state: "building", indexedFiles: 0, totalFiles: 0 };

  static async open(options: SessionSearchIndexOptions): Promise<SessionSearchIndex> {
    await mkdir(dirname(options.filePath), { recursive: true, mode: 0o700 });
    // Pre-create privately: DatabaseSync's default creation mode can be wider.
    const file = await open(options.filePath, "a", 0o600);
    await file.close();
    await chmod(options.filePath, 0o600);
    return new SessionSearchIndex(options);
  }

  private constructor(private readonly options: SessionSearchIndexOptions) {
    this.browserFiles = options.agentDir === undefined ? undefined : new BrowserFileAccess(options.agentDir);
    this.db = new DatabaseSync(options.filePath);
    try {
      this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA cache_size=-8192; CREATE TABLE IF NOT EXISTS versions(schemaVersion INTEGER, extractionVersion INTEGER)");
      const version = this.db.prepare("SELECT * FROM versions").get();
      if (version?.["schemaVersion"] !== SCHEMA_VERSION || version["extractionVersion"] !== EXTRACTION_VERSION) {
        this.db.exec(`BEGIN;
          DROP TABLE IF EXISTS search_text; DROP TABLE IF EXISTS messages; DROP TABLE IF EXISTS entries; DROP TABLE IF EXISTS files;
          DELETE FROM versions;
          INSERT INTO versions VALUES(${String(SCHEMA_VERSION)}, ${String(EXTRACTION_VERSION)});
          CREATE TABLE files(sessionId TEXT PRIMARY KEY, path TEXT NOT NULL, dev INTEGER, ino INTEGER, size INTEGER, mtime REAL, offset INTEGER, tip TEXT);
          CREATE TABLE entries(sessionId TEXT, entryId TEXT, parentId TEXT, PRIMARY KEY(sessionId, entryId), FOREIGN KEY(sessionId) REFERENCES files(sessionId) ON DELETE CASCADE);
          CREATE TABLE messages(id INTEGER PRIMARY KEY, sessionId TEXT, entryId TEXT, role TEXT, timestamp TEXT, text TEXT, UNIQUE(sessionId,entryId), FOREIGN KEY(sessionId) REFERENCES files(sessionId) ON DELETE CASCADE);
          CREATE VIRTUAL TABLE search_text USING fts5(text, content='messages', content_rowid='id', tokenize='trigram');
          CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN INSERT INTO search_text(rowid,text) VALUES(new.id,new.text); END;
          CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN INSERT INTO search_text(search_text,rowid,text) VALUES('delete',old.id,old.text); END;
          COMMIT;`);
      }
      // WAL readers see completed file transactions, never a half-extracted
      // message set or a branch tip left over from the previous append.
      this.queryDb = new DatabaseSync(options.filePath, { readOnly: true });
      this.queryDb.exec("PRAGMA cache_size=-8192");
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void {
    this.queryDb.close();
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.db.close();
  }

  indexStatus(): SessionSearchIndexStatus { return { ...this.status }; }

  async scan(): Promise<void> {
    this.progress({ state: "building", indexedFiles: 0, totalFiles: 0 });
    const discovered = this.discoverFiles();
    this.discovery = discovered.then(() => undefined);
    void this.discovery.catch(() => undefined);
    const unique = await discovered;
    // Prune only after a complete directory walk. An unreadable directory throws
    // instead of making its still-present files look deleted.
    const seen = new Set(unique.map((file) => file.sessionId));
    for (const row of this.db.prepare("SELECT sessionId,path FROM files").all()) {
      if (seen.has(String(row["sessionId"]))) continue;
      const present = await stat(String(row["path"])).then(() => true, (error: unknown) => searchRecord(error)?.["code"] !== "ENOENT");
      if (!present) this.db.prepare("DELETE FROM files WHERE sessionId=?").run(String(row["sessionId"]));
    }
    let indexedFiles = 0;
    for (const file of unique) {
      if (await this.indexFile(file)) indexedFiles++;
      this.progress({ state: "building", indexedFiles, totalFiles: unique.length });
      // Both worker requests and progress consumers can run between files.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this.progress({ ...this.status, state: "ready" });
  }

  waitForDiscovery(): Promise<void> { return this.discovery; }

  private async discoverFiles(): Promise<SearchFile[]> {
    const paths = await this.listFiles(this.options.sessionsDir);
    const files: SearchFile[] = [];
    for (const path of paths) {
      const file = await this.describeFile(path);
      if (file !== undefined && !file.child) files.push(file);
      else if (file?.child === true) this.db.prepare("DELETE FROM files WHERE sessionId=?").run(file.sessionId);
    }
    files.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
    const newestById = new Map<string, SearchFile>();
    for (const file of files) if (!newestById.has(file.sessionId)) newestById.set(file.sessionId, file);
    const unique = [...newestById.values()];
    this.progress({ state: "building", indexedFiles: 0, totalFiles: unique.length });
    return unique;
  }

  async refreshFile(path: string): Promise<void> {
    const file = await this.describeFile(path);
    if (file === undefined) return;
    const existed = this.db.prepare("SELECT 1 FROM files WHERE sessionId=?").get(file.sessionId) !== undefined;
    if (file.child) this.db.prepare("DELETE FROM files WHERE sessionId=?").run(file.sessionId);
    else await this.indexFile(file);
    const exists = this.db.prepare("SELECT 1 FROM files WHERE sessionId=?").get(file.sessionId) !== undefined;
    const delta = Number(exists) - Number(existed);
    if (this.status.state === "ready" && delta !== 0) this.progress({ ...this.status, indexedFiles: this.status.indexedFiles + delta, totalFiles: this.status.totalFiles + delta });
  }

  search(query: string): { hits: IndexedSearchHit[]; index: SessionSearchIndexStatus } {
    const { terms, fts } = parseSearchQuery(query);
    const grouped = new Map<string, { messages: MessageRow[]; found: Set<string> }>();
    // FTS is a candidate accelerator, not the substring contract. Verify each
    // candidate, then require every term across the session's matching messages.
    const rows = this.queryDb.prepare(`SELECT m.sessionId,m.entryId,m.role,m.timestamp,m.text FROM search_text JOIN messages m ON m.id=search_text.rowid WHERE search_text MATCH ? ORDER BY m.timestamp DESC,m.id DESC`).iterate(fts);
    for (const raw of rows) {
      const row = messageRow(raw);
      const lower = row.text.toLowerCase();
      const found = terms.filter((term) => lower.includes(term));
      if (found.length === 0) continue;
      const group = grouped.get(row.sessionId) ?? { messages: [], found: new Set<string>() };
      group.messages.push(row);
      found.forEach((term) => group.found.add(term));
      grouped.set(row.sessionId, group);
    }
    const hits: IndexedSearchHit[] = [];
    for (const [sessionId, group] of grouped) {
      const newest = group.messages[0];
      if (newest === undefined || group.found.size !== terms.length) continue;
      hits.push({ sessionId, passage: searchPassage(newest, terms), otherMatches: group.messages.length - 1, offBranch: !this.branchIds(sessionId).has(newest.entryId) });
    }
    return { hits, index: this.indexStatus() };
  }

  matches(sessionId: string, query: string): SessionSearchMatch[] {
    const { terms, fts } = parseSearchQuery(query);
    return this.queryDb.prepare(`SELECT m.entryId,m.role,m.text FROM search_text JOIN messages m ON m.id=search_text.rowid WHERE search_text MATCH ? AND m.sessionId=? ORDER BY m.id`).all(fts, sessionId).flatMap((row) => {
      const text = String(row["text"]).toLowerCase();
      if (!terms.some((term) => text.includes(term))) return [];
      return [{ entryId: String(row["entryId"]), role: messageRole(row["role"]), offBranch: true }];
    });
  }

  private branchIds(sessionId: string): Set<string> {
    const tip = this.queryDb.prepare("SELECT tip FROM files WHERE sessionId=?").get(sessionId)?.["tip"];
    const parents = new Map(this.queryDb.prepare("SELECT entryId,parentId FROM entries WHERE sessionId=?").all(sessionId).map((row) => [String(row["entryId"]), row["parentId"]]));
    const branch = new Set<string>();
    let id = tip;
    while (typeof id === "string" && !branch.has(id)) { branch.add(id); id = parents.get(id); }
    return branch;
  }

  private async indexFile(file: SearchFile): Promise<boolean> {
    if (this.browserFiles !== undefined && !await this.browserFiles.isReadable(file.path)) return false;
    const cached = this.db.prepare("SELECT * FROM files WHERE sessionId=?").get(file.sessionId);
    if (cached?.["dev"] === file.dev && cached["ino"] === file.ino && Number(cached["size"]) === file.size && cached["mtime"] === file.mtime) {
      this.db.prepare("UPDATE files SET path=? WHERE sessionId=?").run(file.path, file.sessionId);
      return true;
    }
    const source = await openBrowserFile(file.path, this.browserFiles).catch((error: unknown) => { this.logSkip(file.path, error); return undefined; });
    if (source === undefined) return false;
    let metadata;
    try { metadata = await source.stat(); }
    catch (error) { await source.close(); this.logSkip(file.path, error); return false; }
    file = { ...file, dev: metadata.dev, ino: metadata.ino, size: metadata.size, mtime: metadata.mtimeMs };
    const append = cached?.["dev"] === file.dev && cached["ino"] === file.ino && file.size > Number(cached["size"]);
    const offset = append ? Number(cached["offset"]) : 0;
    let tip = append && typeof cached["tip"] === "string" ? cached["tip"] : null;
    this.db.exec("BEGIN");
    try {
      if (!append) this.db.prepare("DELETE FROM files WHERE sessionId=?").run(file.sessionId);
      this.db.prepare("INSERT INTO files(sessionId,path,dev,ino,size,mtime,offset,tip) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(sessionId) DO UPDATE SET path=excluded.path").run(file.sessionId, file.path, file.dev, file.ino, file.size, file.mtime, offset, tip);
      const putEntry = this.db.prepare("INSERT OR REPLACE INTO entries VALUES(?,?,?)");
      const putMessage = this.db.prepare("INSERT OR IGNORE INTO messages(sessionId,entryId,role,timestamp,text) VALUES(?,?,?,?,?)");
      const end = await readSearchLines(source, offset, file.size, (value) => {
        const entry = searchRecord(value);
        if (entry === undefined || entry["type"] === "session" || typeof entry["id"] !== "string") return;
        tip = entry["id"];
        putEntry.run(file.sessionId, tip, typeof entry["parentId"] === "string" ? entry["parentId"] : null);
        const message = extractSearchMessage(entry);
        if (message !== undefined) putMessage.run(file.sessionId, message.entryId, message.role, message.timestamp, message.text);
      });
      this.db.prepare("UPDATE files SET path=?,dev=?,ino=?,size=?,mtime=?,offset=?,tip=? WHERE sessionId=?").run(file.path, file.dev, file.ino, file.size, file.mtime, end, tip, file.sessionId);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.logSkip(file.path, error);
      return false;
    } finally { await source.close(); }
  }

  private async listFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    let items;
    try { items = await readdir(dir, { withFileTypes: true }); }
    catch (error) {
      if (dir === this.options.sessionsDir && searchRecord(error)?.["code"] === "ENOENT") return [];
      throw error;
    }
    for (const item of items) {
      const path = join(dir, item.name);
      if (item.isDirectory()) files.push(...await this.listFiles(path));
      else if (item.name.endsWith(".jsonl")) files.push(path);
    }
    return files;
  }

  private async describeFile(path: string): Promise<SearchFile | undefined> {
    try {
      if (this.browserFiles !== undefined && !await this.browserFiles.isReadable(path)) return undefined;
      const metadata = await stat(path);
      const file = await openBrowserFile(path, this.browserFiles);
      let header: Record<string, unknown> | undefined;
      try {
        const buffer = Buffer.alloc(4096);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        header = searchRecord(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0] ?? ""));
      } finally { await file.close(); }
      if (header?.["type"] !== "session" || typeof header["id"] !== "string") throw new Error("Invalid session header");
      return { path, sessionId: header["id"], dev: metadata.dev, ino: metadata.ino, size: metadata.size, mtime: metadata.mtimeMs, child: header["agentSpawned"] === true };
    } catch (error) { this.logSkip(path, error); return undefined; }
  }

  private progress(status: SessionSearchIndexStatus): void { this.status = status; this.options.onProgress?.(this.indexStatus()); }
  private logSkip(path: string, error: unknown): void { this.options.log(`Session search skipped ${path}: ${String(error)}`); }
}

/** Keep only complete lines. An interrupted append resumes at its last newline. */
async function readSearchLines(file: Awaited<ReturnType<typeof open>>, start: number, size: number, consume: (value: unknown) => void): Promise<number> {
  const chunk = Buffer.allocUnsafe(256 * 1024);
  let position = start;
  let offset = start;
  let parts: Buffer[] = [];
  while (position < size) {
    const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, size - position), position);
    if (bytesRead === 0) break;
    const data = chunk.subarray(0, bytesRead);
    let begin = 0;
    for (let at = data.indexOf(10); at !== -1; at = data.indexOf(10, begin)) {
      parts.push(Buffer.from(data.subarray(begin, at)));
      const line = Buffer.concat(parts).toString("utf8");
      try { consume(JSON.parse(line)); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      parts = [];
      offset = position + at + 1;
      begin = at + 1;
    }
    if (begin < data.length) parts.push(Buffer.from(data.subarray(begin)));
    position += bytesRead;
  }
  return offset;
}

function messageRole(value: unknown): "user" | "assistant" {
  if (value !== "user" && value !== "assistant") throw new Error("Invalid indexed role");
  return value;
}

function messageRow(row: Record<string, unknown>): MessageRow {
  return { sessionId: String(row["sessionId"]), entryId: String(row["entryId"]), role: messageRole(row["role"]), timestamp: String(row["timestamp"]), text: String(row["text"]) };
}
