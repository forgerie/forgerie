import { createHash } from "node:crypto";
import { isAbsolute, normalize, sep } from "node:path";
import { Worker } from "node:worker_threads";
import type { SessionInfo } from "../../shared/apiTypes.js";
import type { SessionSearchIndexStatus, SessionSearchMatchesResponse, SessionSearchResponse } from "../../shared/sessionSearch.js";
import type { IndexedSearchHit } from "./sessionSearchIndex.js";
import type { SearchWorkerCommand, SearchWorkerOptions, SearchWorkerReply, SearchWorkerResult } from "./sessionSearchProtocol.js";
import { parseSearchQuery, SessionSearchError } from "./sessionSearchText.js";

export interface SessionSearchRequest { q: string; scope?: string[]; cursor?: string; limit?: number }
export interface SessionSearchRoutesService {
  search(request: SessionSearchRequest): Promise<SessionSearchResponse>;
  matches(sessionId: string, cwd: string, query: string): Promise<SessionSearchMatchesResponse>;
}

interface SessionSearchDependencies extends SearchWorkerOptions {
  catalog: () => Promise<SessionInfo[]>;
  positions: (ref: { id: string; cwd: string }) => Promise<ReadonlyMap<string, number>>;
  log: (message: string) => void;
}

/** Main-thread boundary: the catalog and live branch remain the source of truth. */
export class SessionSearchService implements SessionSearchRoutesService {
  private readonly worker: Worker;
  private nextId = 0;
  private closing = false;
  private unavailable: Error | undefined;
  private readonly pending = new Map<number, { resolve: (value: SearchWorkerResult) => void; reject: (error: Error) => void }>();

  constructor(private readonly deps: SessionSearchDependencies) {
    const url = new URL("./sessionSearchWorker.js", import.meta.url);
    const options: SearchWorkerOptions = { filePath: deps.filePath, sessionsDir: deps.sessionsDir };
    if (import.meta.url.endsWith(".ts")) {
      url.pathname = url.pathname.replace(/\.js$/u, ".ts");
      // Node's worker loader does not inherit tsx's in-process registration.
      this.worker = new Worker(`const {workerData}=require('node:worker_threads');
        import('tsx/esm/api').then(({register})=>{register();return import(workerData.moduleUrl)}).catch(error=>{throw error});`,
      { eval: true, workerData: { ...options, moduleUrl: url.href } });
    } else this.worker = new Worker(url, { workerData: options });
    this.worker.on("message", (reply: SearchWorkerReply) => {
      if (reply.kind === "log") { deps.log(reply.message); return; }
      if (reply.kind === "progress") return;
      const pending = this.pending.get(reply.id);
      this.pending.delete(reply.id);
      if (reply.kind === "result") pending?.resolve(reply.result);
      else pending?.reject(new SessionSearchError("index_unavailable", reply.error));
    });
    this.worker.on("error", (error: Error) => { this.fail(error); });
    this.worker.on("exit", (code) => { if (!this.closing) this.fail(new Error(`Session search worker exited (${String(code)})`)); });
  }

  async scan(): Promise<void> { await this.request({ kind: "scan" }); }
  async refreshFile(path: string): Promise<void> { await this.request({ kind: "refresh", path }); }

  async close(): Promise<void> {
    this.closing = true;
    try { if (this.unavailable === undefined) await this.request({ kind: "close" }); }
    finally {
      this.unavailable = new Error("Session search closed");
      for (const pending of this.pending.values()) pending.reject(new SessionSearchError("index_unavailable", this.unavailable.message));
      this.pending.clear();
      await this.worker.terminate();
    }
  }

  async search(request: SessionSearchRequest): Promise<SessionSearchResponse> {
    const parsed = parseSearchQuery(request.q);
    const scopes = (request.scope ?? []).map((scope) => {
      if (!isAbsolute(scope)) throw new SessionSearchError("invalid_request", "scope must be an absolute folder");
      return normalize(scope).replace(/\/$/u, "") || sep;
    }).sort();
    const limit = request.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1) throw new SessionSearchError("invalid_request", "limit must be a positive integer");
    const fingerprint = createHash("sha256").update(JSON.stringify([parsed.terms, scopes])).digest("hex");
    const after = decodeCursor(request.cursor, fingerprint);
    const [indexed, catalog] = await Promise.all([
      this.request({ kind: "search", query: request.q }),
      this.deps.catalog(),
    ]);
    const byId = new Map(catalog.filter((session) => session.agentSpawned !== true && session.persisted !== false).map((session) => [session.id, session]));
    const hits = indexed.hits.flatMap((hit) => {
      const session = byId.get(hit.sessionId);
      if (session === undefined || (scopes.length > 0 && !scopes.some((scope) => session.cwd === scope || session.cwd.startsWith(scope === sep ? scope : scope + sep)))) return [];
      return [{ ...hit, cwd: session.cwd, title: (session.name === undefined || session.name === "" ? session.firstMessage : session.name) || "Untitled session", modified: session.modified, archived: session.archived === true }];
    }).sort((a, b) => b.modified.localeCompare(a.modified) || a.sessionId.localeCompare(b.sessionId));
    const remaining = after === undefined ? hits : hits.filter((hit) => hit.modified < after.modified || (hit.modified === after.modified && hit.sessionId > after.sessionId));
    const page = remaining.slice(0, Math.min(100, limit));
    const last = page.at(-1);
    return { hits: page, index: indexed.index, ...(remaining.length > page.length && last !== undefined ? {
      nextCursor: Buffer.from(JSON.stringify({ fingerprint, modified: last.modified, sessionId: last.sessionId })).toString("base64url"),
    } : {}) };
  }

  async matches(sessionId: string, cwd: string, query: string): Promise<SessionSearchMatchesResponse> {
    parseSearchQuery(query);
    const catalog = await this.deps.catalog();
    const session = catalog.find((item) => item.id === sessionId && item.cwd === cwd && item.persisted !== false && item.agentSpawned !== true);
    if (session === undefined) throw new SessionSearchError("invalid_request", "Session not found");
    const [matches, positions] = await Promise.all([
      this.request({ kind: "matches", sessionId, query }),
      this.deps.positions({ id: sessionId, cwd }),
    ]);
    const authoritative = matches.map((match) => {
      const position = positions.get(match.entryId);
      return { ...match, offBranch: position === undefined, ...(position === undefined ? {} : { position }) };
    });
    authoritative.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
    return { matches: authoritative };
  }

  private request(request: { kind: "search"; query: string }): Promise<{ hits: IndexedSearchHit[]; index: SessionSearchIndexStatus }>;
  private request(request: { kind: "matches"; sessionId: string; query: string }): Promise<SessionSearchMatchesResponse["matches"]>;
  private request(request: { kind: "refresh"; path: string } | { kind: "scan" } | { kind: "close" }): Promise<undefined>;
  private request(request: SearchWorkerCommand): Promise<SearchWorkerResult> {
    if (this.closing && request.kind !== "close") return Promise.reject(new SessionSearchError("index_unavailable", "Session search closed"));
    if (this.unavailable !== undefined) return Promise.reject(new SessionSearchError("index_unavailable", this.unavailable.message));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id });
    });
  }

  private fail(error: Error): void {
    this.unavailable = error;
    this.deps.log(error.message);
    for (const pending of this.pending.values()) pending.reject(new SessionSearchError("index_unavailable", error.message));
    this.pending.clear();
  }
}

function decodeCursor(cursor: string | undefined, fingerprint: string): { modified: string; sessionId: string } | undefined {
  if (cursor === undefined || cursor === "") return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof value !== "object" || value === null || !("fingerprint" in value) || value.fingerprint !== fingerprint || !("modified" in value) || typeof value.modified !== "string" || !("sessionId" in value) || typeof value.sessionId !== "string") throw new Error("Invalid cursor");
    return { modified: value.modified, sessionId: value.sessionId };
  } catch { throw new SessionSearchError("invalid_request", "Invalid search cursor"); }
}
