import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { appendFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../../shared/apiTypes.js";
import type { SessionSearchResponse, SessionSearchMatchesResponse } from "../../shared/sessionSearch.js";
import { registerSessionProxyRoutes } from "../sessiond/sessionProxyRoutes.js";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, fakeSessionManager, runtimeCreator, sessionGateway, sessionRecord, testModelRuntime } from "./piSessionService.testSupport.js";
import { registerSessionRoutes } from "./sessionRoutes.js";
import { registerSessionSearchRoutes } from "./sessionSearchRoutes.js";
import { SessionSearchService } from "./sessionSearchService.js";
import { searchEntry, writeSearchSession } from "./sessionSearch.testSupport.js";

let dir: string;
let app: FastifyInstance;
let browser: FastifyInstance;
let search: SessionSearchService;
let sessions: PiSessionService;
let catalog: SessionInfo[];
let logs: string[];
function info(id: string, cwd = "/repo", modified = "2026-01-01T00:00:00.000Z"): SessionInfo {
  return { id, cwd, path: join(dir, "sessions", `${id}.jsonl`), created: modified, modified, messageCount: 1, firstMessage: "Title " + id, persisted: true };
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "search-routes-"));
  catalog = [info("one"), info("two", "/repo/sub", "2026-01-02T00:00:00.000Z"), info("three", "/repo-other"), { ...info("child"), agentSpawned: true }, { ...info("ghost"), persisted: false }];
  logs = [];
  for (const id of ["one", "two", "three", "child", "unknown", "ghost"]) await writeSearchSession(join(dir, "sessions", `${id}.jsonl`), id);
  const gateway = sessionGateway(catalog.map((item) => ({ ...sessionRecord(item.id, item.cwd), path: item.path })));
  sessions = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: join(dir, "agent"), modelRuntime: testModelRuntime, archiveStore: emptyArchiveStore(),
    sessionManager: { ...gateway, open: (path) => SessionManager.open(path) }, heartbeatIntervalMs: 60_000,
  });
  search = new SessionSearchService({ filePath: join(dir, "index.sqlite"), sessionsDir: join(dir, "sessions"), catalog: () => Promise.resolve(catalog), positions: (ref) => sessions.searchMessagePositions(ref), log: (line) => logs.push(line) });
  await search.scan();
  app = Fastify(); await app.register(websocket);
  registerSessionSearchRoutes(app, search); registerSessionRoutes(app, sessions, new CapturingSessionEventHub());
  browser = Fastify(); await browser.register(websocket);
  const forward = { request: async (method: string, path: string) => {
    const response = await app.inject({ method: httpMethod(method), url: path });
    return { statusCode: response.statusCode, headers: { "content-type": "application/json" }, body: response.body };
  }, connectWebSocket: () => { throw new Error("Not used"); } };
  registerSessionProxyRoutes(browser, forward); registerSessionProxyRoutes(browser, forward, "/api/machines/local");
});
afterEach(async () => { await browser.close(); await app.close(); await search.close(); await sessions.dispose(); await rm(dir, { recursive: true, force: true }); });

describe("session search HTTP and proxy contract", () => {
  it("rejects short queries before accessing the index and validates the boundary", async () => {
    for (const q of ["", "a to", "*"]) {
      const response = await app.inject("/sessions/search?q=" + encodeURIComponent(q));
      expect(response.statusCode).toBe(400); expect(response.json<{ code: string }>().code).toBe("query_too_short");
    }
    for (const suffix of ["&scope=relative", "&limit=0", "&limit=no", "&cursor=broken"]) expect((await app.inject("/sessions/search?q=searchable" + suffix)).statusCode).toBe(400);
    expect((await app.inject("/sessions/one/search-matches?q=searchable")).statusCode).toBe(400);
    expect((await app.inject("/sessions/one/search-matches?q=searchable&cwd=relative")).statusCode).toBe(400);
  });
  it("joins live titles, archive flags and modified dates; drops children, ghosts, missing sessions", async () => {
    catalog[1] = { ...info("two", "/repo/sub", "2026-01-04T00:00:00.000Z"), name: "Renamed live", archived: true };
    const response = await app.inject("/sessions/search?q=searchable");
    const data = response.json<SessionSearchResponse>();
    expect(response.statusCode).toBe(200); expect(data.hits.map((hit) => hit.sessionId)).toEqual(["two", "one", "three"]);
    expect(data.hits[0]).toMatchObject({ title: "Renamed live", archived: true, modified: "2026-01-04T00:00:00.000Z" });
    catalog = []; expect((await app.inject("/sessions/search?q=searchable")).json<SessionSearchResponse>().hits).toEqual([]);
  });
  it("applies scope at a path-segment boundary, repeats scopes and pages with an opaque cursor", async () => {
    const first = (await app.inject("/sessions/search?q=searchable&scope=/repo/&limit=1")).json<SessionSearchResponse>();
    expect(first.hits.map((hit) => hit.sessionId)).toEqual(["two"]); expect(first.nextCursor).toBeDefined();
    const second = (await app.inject("/sessions/search?q=searchable&scope=/repo/&limit=1&cursor=" + (first.nextCursor ?? ""))).json<SessionSearchResponse>();
    expect(second.hits.map((hit) => hit.sessionId)).toEqual(["one"]); expect(second.nextCursor).toBeUndefined();
    expect((await app.inject("/sessions/search?q=searchable&scope=/repo&scope=/repo-other")).json<SessionSearchResponse>().hits).toHaveLength(3);
    expect((await app.inject("/sessions/search?q=different&scope=/repo/&cursor=" + (first.nextCursor ?? ""))).statusCode).toBe(400);
  });
  it("caps pages at 100 hits", async () => {
    for (let i = 0; i < 102; i++) {
      const id = "extra-" + String(i); const item = info(id); catalog.push(item); await writeSearchSession(item.path, id);
    }
    await search.scan();
    const data = (await app.inject("/sessions/search?q=searchable&limit=1000")).json<SessionSearchResponse>();
    expect(data.hits).toHaveLength(100); expect(data.nextCursor).toBeDefined();
  });
  it("maps matches to the same raw positions as /messages and recomputes the live branch", async () => {
    const entries = [
      searchEntry("root", null, "needle root"),
      searchEntry("other", "root", "needle other", "assistant", "2026-01-05T00:00:00.000Z"),
      { type: "custom_message", id: "notice", parentId: "root", display: true, customType: "notice", content: "a notice" },
      { type: "compaction", id: "compact", parentId: "notice", summary: "a summary" },
      searchEntry("tool", "compact", "needle hidden", "toolResult"),
      searchEntry("current", "tool", "needle current", "assistant"),
    ];
    await rename(info("one").path, info("one").path + ".old");
    await writeSearchSession(info("one").path, "one", entries); await search.refreshFile(info("one").path);
    const hit = (await app.inject("/sessions/search?q=needle")).json<SessionSearchResponse>().hits[0]; expect(hit?.offBranch).toBe(true);
    const page = (await app.inject("/sessions/one/messages?cwd=/repo")).json<{ messages: { content: unknown }[]; total: number }>();
    const data = (await app.inject("/sessions/one/search-matches?q=needle&cwd=/repo")).json<SessionSearchMatchesResponse>();
    expect(page.total).toBe(5);
    expect(data.matches).toEqual([{ entryId: "root", role: "user", offBranch: false, position: 0 }, { entryId: "current", role: "assistant", offBranch: false, position: 4 }, { entryId: "other", role: "assistant", offBranch: true }]);
    expect(page.messages[data.matches[1]?.position ?? -1]?.content).toEqual([{ type: "text", text: "needle current" }]);
    // Change the persisted live branch without refreshing the index.
    await appendFile(info("one").path, JSON.stringify({ type: "label", id: "switch", parentId: "other", targetId: "other", label: "selected" }) + "\n");
    const changed = (await app.inject("/sessions/one/search-matches?q=needle&cwd=/repo")).json<SessionSearchMatchesResponse>();
    expect(changed.matches).toEqual([{ entryId: "root", role: "user", offBranch: false, position: 0 }, { entryId: "other", role: "assistant", offBranch: false, position: 1 }, { entryId: "current", role: "assistant", offBranch: true }]);
  });
  it.each(["/api", "/api/machines/local"])("reaches both real routes through %s", async (prefix) => {
    const hits = await browser.inject(prefix + "/sessions/search?q=searchable&scope=%2Frepo");
    expect(hits.statusCode).toBe(200); expect(hits.json<SessionSearchResponse>().hits).toHaveLength(2);
    const matches = await browser.inject(prefix + "/sessions/one/search-matches?q=searchable&cwd=%2Frepo");
    expect(matches.statusCode).toBe(200); expect(matches.json<SessionSearchMatchesResponse>().matches[0]).toMatchObject({ entryId: "first", position: 0, offBranch: false });
  });
  it("serves partial hits and building counts over HTTP while the worker scans", async () => {
    const buildDir = join(dir, "building");
    const buildCatalog = Array.from({ length: 40 }, (_, i) => info("build-" + String(i)));
    await Promise.all(buildCatalog.map((item) => writeSearchSession(join(buildDir, item.id + ".jsonl"), item.id, [searchEntry("first", null, "buildneedle ".repeat(2000))])));
    const building = new SessionSearchService({ filePath: join(dir, "building.sqlite"), sessionsDir: buildDir, catalog: () => Promise.resolve(buildCatalog), positions: () => Promise.resolve(new Map()), log: (line) => logs.push(line) });
    const routes = Fastify(); registerSessionSearchRoutes(routes, building);
    try {
      const build = { complete: false };
      const scan = building.scan().finally(() => { build.complete = true; });
      const observations: SessionSearchResponse[] = [];
      while (!build.complete) observations.push((await routes.inject("/sessions/search?q=buildneedle")).json<SessionSearchResponse>());
      await scan;
      expect(observations.every((data) => data.index.totalFiles === 40)).toBe(true);
      const partial = observations.find((data) => data.index.state === "building" && data.index.indexedFiles > 0 && data.index.indexedFiles < 40);
      expect(partial?.index.totalFiles).toBe(40);
      expect(partial?.hits.length).toBeGreaterThan(0);
      expect((await routes.inject("/sessions/search?q=buildneedle")).json<SessionSearchResponse>().index).toEqual({ state: "ready", indexedFiles: 40, totalFiles: 40 });
    } finally { await routes.close(); await building.close(); }
  });

  it("returns 503 when the index cannot open while other routes still serve", async () => {
    await search.close(); await mkdir(join(dir, "cannot-open"));
    search = new SessionSearchService({ filePath: join(dir, "cannot-open"), sessionsDir: join(dir, "sessions"), catalog: () => Promise.resolve(catalog), positions: () => Promise.resolve(new Map()), log: (line) => logs.push(line) });
    const unavailable = Fastify(); registerSessionSearchRoutes(unavailable, search);
    try {
      const response = await unavailable.inject("/sessions/search?q=searchable");
      expect(response.statusCode).toBe(503); expect(response.json<{ code: string }>().code).toBe("index_unavailable");
      expect(logs.join("\n")).toContain("unavailable");
      expect((await app.inject("/sessions/one/messages?cwd=/repo")).statusCode).toBe(200);
      expect((await unavailable.inject("/sessions/search?q=to")).statusCode).toBe(400);
    } finally { await unavailable.close(); }
  });
});

it("refreshes persisted text after run settlement, not the earlier agent_end", async () => {
  const path = info("one").path;
  const runtime = fakeRuntime("one", { sessionFile: path, sessionManager: fakeSessionManager("/repo", { getSessionId: () => "one", getSessionFile: () => path }) });
  const refreshFile = vi.fn((file: string) => search.refreshFile(file));
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: join(dir, "agent"), modelRuntime: testModelRuntime, sessionManager: sessionGateway([sessionRecord("one", "/repo")]), archiveStore: emptyArchiveStore(), createAgentRuntime: runtimeCreator(runtime.runtime), sessionSearch: { refreshFile, scan: () => search.scan() }, heartbeatIntervalMs: 60_000,
  });
  try {
    await service.status({ id: "one", cwd: "/repo" });
    runtime.emit({ type: "agent_end" });
    expect(refreshFile).not.toHaveBeenCalled();
    await appendFile(path, JSON.stringify(searchEntry("settled", "first", "settled append needle")) + "\n");
    runtime.emit({ type: "agent_settled", aborted: false });
    expect(refreshFile).toHaveBeenCalledExactlyOnceWith(path);
    await expect.poll(async () => (await search.search({ q: "needle" })).hits[0]?.passage.entryId).toBe("settled");
  } finally { await service.dispose(); }
});

function httpMethod(value: string): "GET" {
  if (value !== "GET") throw new Error("Unexpected method");
  return value;
}
