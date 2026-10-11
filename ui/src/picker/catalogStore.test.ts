import { createServer } from "node:http";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyCatalogEvent, createCatalogStore, type CatalogState, type CatalogStore } from "./catalogStore";
import type { SessionTransport } from "../sessionStore";
import { attention, rows } from "./board";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

const idle = { isStreaming: false, isCompacting: false, isBashRunning: false };

/** A real HTTP + WebSocket server whose catalog the test can change between joins. */
async function machine(options: { holdListing?: Promise<void>; badListing?: boolean; pulls?: unknown[] } = {}) {
  let listing = {
    sessions: [
      { id: "a", cwd: "/code/forgerie", name: "Alpha", modified: "2026-09-29T18:00:00.000Z" },
      { id: "b", cwd: "/code/forgerie", modified: "2026-09-29T17:00:00.000Z", archived: true },
    ],
    statuses: [{ sessionId: "a", ...idle, workingAgents: 2 }],
    activities: [{ sessionId: "a", phase: "idle" }],
  };
  let asks: { sessions: unknown[] } = { sessions: [] };
  const clients = new Set<ServerSocket>();
  let reads = 0;
  let hold = options.holdListing;
  const writes: { path: string; body: unknown }[] = [];
  const refusals = new Map<string, { status: number; body: unknown }>();
  const sockets = new WebSocketServer({ noServer: true });
  const http = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://x").pathname;
    const send = (body: unknown, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
    if (request.method === "POST") {
      let raw = "";
      request.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
      request.on("end", () => {
        const body: unknown = JSON.parse(raw);
        writes.push({ path, body });
        const refusal = refusals.get(path);
        if (refusal) { send(refusal.body, refusal.status); return; }
        if (path === "/api/sessions/bulk/delete-archived") {
          const ids = (body as { sessions: { id: string }[] }).sessions.map((session) => session.id);
          send({ deleted: true, deletedSessionIds: ids, failures: [], generatedAt: "now" });
        } else send({ ok: true });
      });
      return;
    }
    if (path === "/api/sessions/all") {
      reads += 1;
      // The reply carries the catalog as it was when the read arrived.
      const snapshot = listing;
      void (hold ?? Promise.resolve()).then(() => send(options.badListing ? { sessions: "nope" } : snapshot));
    } else if (path === "/api/sessions/asks") send(asks);
    else if (path === "/api/sessions/unread") send({ catalogId: "c", catalogRevision: 1, sessions: [] });
    else if (path === "/api/machines/local/projects") send([{ id: "p", name: "forgerie", path: "/code/forgerie" }]);
    // Without pulls, the server predates pull request links and answers 404.
    else if (path === "/api/github/pulls" && options.pulls) send({ links: options.pulls });
    else { response.writeHead(404); response.end(); }
  });
  http.on("upgrade", (request, socket, head) => sockets.handleUpgrade(request, socket, head, (client) => {
    clients.add(client);
    client.on("close", () => clients.delete(client));
  }));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const origin = `http://127.0.0.1:${String(address.port)}`;
  const transport: SessionTransport = {
    request: (path, init) => fetch(origin + path, init),
    connect: (path) => new WebSocket(origin.replace("http:", "ws:") + path),
  };
  cleanup.push(async () => {
    for (const client of clients) client.terminate();
    sockets.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  return {
    transport,
    emit: (event: unknown) => { for (const client of clients) client.send(Buffer.from(JSON.stringify(event))); },
    drop: () => { for (const client of clients) client.terminate(); },
    setListing: (next: typeof listing) => { listing = next; },
    setAsks: (next: typeof asks) => { asks = next; },
    reads: () => reads,
    writes,
    refuse: (path: string, status: number, body: unknown) => { refusals.set(path, { status, body }); },
    holdListing: (next: Promise<void>) => { hold = next; },
  };
}
function until(store: CatalogStore, predicate: () => boolean) {
  if (predicate()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { stop(); reject(new Error(`State did not settle: ${JSON.stringify(store.getSnapshot().connection)}`)); }, 3000);
    const stop = store.subscribe(() => { if (predicate()) { clearTimeout(timeout); stop(); resolve(); } });
  });
}
function start(api: Awaited<ReturnType<typeof machine>>) {
  const store = createCatalogStore(api.transport, { timing: { retryDelayMs: 20, maxRetryDelayMs: 40 } });
  cleanup.push(store.dispose);
  void store.start();
  return store;
}

describe("pull request links", () => {
  const watching = { kind: "watching", since: "2026-10-07T21:00:00.000Z", wakes: 0 };
  const link = { session: { id: "a", cwd: "/code/forgerie" }, repo: "o/r", number: 142, watch: { kind: "off" } };
  it("joins every link a session has, then follows link, watch, and unlink events one pull request at a time", async () => {
    const second = { ...link, number: 143 };
    const api = await machine({ pulls: [link, second] });
    const store = start(api);
    const pulls = () => store.getSnapshot().sessions.find((session) => session.id === "a")?.pullRequests;
    await until(store, () => store.getSnapshot().connection.type === "ready");
    expect(pulls()).toEqual([link, second]);
    api.emit({ type: "session.pull-request", link: { ...second, watch: watching } });
    await until(store, () => pulls()?.[1]?.watch.kind === "watching");
    expect(pulls()?.[0]).toEqual(link);
    api.emit({ type: "session.pull-request", link: { ...link, number: 150 } });
    await until(store, () => pulls()?.length === 3);
    api.emit({ type: "session.pull-request.unlinked", link: { ...link, repo: "O/R" } });
    await until(store, () => pulls()?.map((item) => item.number).join() === "143,150");
  });
  it("still lists sessions when the server has no pull request catalog", async () => {
    const api = await machine();
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "ready");
    expect(store.getSnapshot().sessions.map((session) => session.pullRequests)).toEqual([undefined, undefined]);
  });
});

describe("live event cost", () => {
  const base: CatalogState = { connection: { type: "ready" }, sessions: [], statuses: {}, activities: {}, unread: new Set(), projects: [] };
  it("returns the same state for an event that changes nothing the picker draws", () => {
    const status = { sessionId: "a", ...idle, workingAgents: 1 };
    const once = applyCatalogEvent(base, { type: "status.update", status });
    expect(once).not.toBe(base);
    expect(applyCatalogEvent(once, { type: "status.update", status: { ...status } })).toBe(once);
    const activity = { sessionId: "a", phase: "active" as const, activeSince: "2026-09-29T18:00:00.000Z" };
    const active = applyCatalogEvent(once, { type: "activity.update", activity });
    expect(applyCatalogEvent(active, { type: "activity.update", activity: { ...activity } })).toBe(active);
    expect(applyCatalogEvent(active, { type: "activity.update", activity: { ...activity, phase: "idle" } })).not.toBe(active);
  });

  it("tells the view once for a burst of live events", async () => {
    const api = await machine();
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "ready");
    let calls = 0;
    const stop = store.subscribe(() => { calls += 1; });
    for (let n = 1; n <= 50; n += 1) api.emit({ type: "status.update", status: { sessionId: "a", ...idle, workingAgents: n } });
    await until(store, () => store.getSnapshot().statuses["a"]?.workingAgents === 50);
    await new Promise((resolve) => setTimeout(resolve, 50));
    stop();
    expect(calls).toBeLessThan(10);
  });

  it("hands startup progress to whoever started the session, without touching the catalog", async () => {
    const api = await machine();
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "ready");
    const before = store.getSnapshot();
    const seen: unknown[] = [];
    const stop = store.onStartup((event) => seen.push(event));
    api.emit({ type: "session.startup", startupToken: "start-1", activity: { sessionId: "s1", phase: "active", label: "Refreshing provider models", at: "now" } });
    await expect.poll(() => seen.length, { timeout: 2000 }).toBe(1);
    expect(seen[0]).toMatchObject({ startupToken: "start-1", activity: { label: "Refreshing provider models" } });
    expect(store.getSnapshot()).toBe(before);
    stop();
  });
});

describe("machine catalog", () => {
  it("clears an undeclared completion's attention mark when its unread event clears", async () => {
    const api = await machine();
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "ready");
    const board = () => rows({ ...store.getSnapshot(), locate: () => ({ projectKey: "p", project: "forgerie" }), now: Date.now() });
    api.emit({ type: "status.update", status: { sessionId: "a", ...idle, response: { kind: "needs-response", reason: "undeclared" } } });
    api.emit({ type: "sessions.unread", sessionId: "a", cwd: "/code/forgerie", catalogId: "c", catalogRevision: 2, unread: { completionOrder: 1 } });
    await until(store, () => store.getSnapshot().unread.has("a"));
    expect(board().find((row) => row.session.id === "a")?.state).toBe("unread");
    expect(attention(board())).toBe("unread");
    api.emit({ type: "sessions.unread", sessionId: "a", cwd: "/code/forgerie", catalogId: "c", catalogRevision: 3, unread: null });
    await until(store, () => !store.getSnapshot().unread.has("a"));
    expect(board().find((row) => row.session.id === "a")?.state).toBe("open");
    expect(attention(board())).toBeUndefined();
  });
  it("reads explicit response intent from live status and observes only new unread work", async () => {
    const api = await machine();
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "ready");
    const changed = vi.fn();
    const unwatch = store.onUnread(changed);
    api.emit({ type: "status.update", status: { sessionId: "a", ...idle, response: { kind: "needs-response", reason: "reply" } } });
    await until(store, () => store.getSnapshot().statuses["a"]?.needsResponse === true);
    api.emit({ type: "sessions.unread", sessionId: "a", cwd: "/code/forgerie", catalogId: "c", catalogRevision: 2, unread: { completionOrder: 1 } });
    await until(store, () => store.getSnapshot().unread.has("a"));
    expect(changed).toHaveBeenCalledExactlyOnceWith("a");
    api.emit({ type: "sessions.unread", sessionId: "a", cwd: "/code/forgerie", catalogId: "c", catalogRevision: 3, unread: null });
    await until(store, () => !store.getSnapshot().unread.has("a"));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().statuses["a"]?.needsResponse).toBe(true);
    unwatch();
    api.emit({ type: "sessions.unread", sessionId: "a", cwd: "/code/forgerie", catalogId: "c", catalogRevision: 4, unread: { completionOrder: 2 } });
    await until(store, () => store.getSnapshot().unread.has("a"));
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it("joins with sessions, statuses, activities, and projects", async () => {
    const api = await machine();
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "ready");
    const state = store.getSnapshot();
    expect(state.sessions.map((session) => session.id)).toEqual(["a", "b"]);
    expect(state.statuses["a"]).toMatchObject({ workingAgents: 2, blocked: false });
    expect(state.projects).toEqual([{ id: "p", name: "forgerie", path: "/code/forgerie" }]);
  });

  it("marks a session blocked from the asks catalog even without a live status", async () => {
    const api = await machine();
    api.setAsks({ sessions: [{ id: "b", cwd: "/code/forgerie", pendingAsk: { askId: "q1" } }] });
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "ready");
    expect(store.getSnapshot().statuses["b"]).toMatchObject({ blocked: true, isStreaming: false });
  });

  it("marks a session blocked while a child agent or a workflow stop waits on the reader", async () => {
    const api = await machine();
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "ready");
    api.emit({ type: "status.update", status: { sessionId: "a", ...idle, workingAgents: 1, waitingOnYou: 1 } });
    await until(store, () => store.getSnapshot().statuses["a"]?.blocked === true);
    api.emit({ type: "status.update", status: { sessionId: "a", ...idle, workingAgents: 1 } });
    await until(store, () => store.getSnapshot().statuses["a"]?.blocked === false);
  });

  it("applies live events after the join", async () => {
    const api = await machine();
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "ready");
    api.emit({ type: "status.update", status: { sessionId: "a", ...idle, isStreaming: true, pendingAsk: { askId: "q" } } });
    api.emit({ type: "session.name", sessionId: "a", name: "Renamed" });
    api.emit({ type: "session.created", session: { id: "c", cwd: "/code/forgerie", modified: "2026-09-29T18:30:00.000Z" } });
    api.emit({ type: "sessions.unread", sessionId: "a", cwd: "/code/forgerie", catalogId: "c", catalogRevision: 2, unread: { completionOrder: 1 } });
    api.emit({ type: "workspace.activity", activity: {} });
    await until(store, () => store.getSnapshot().unread.has("a"));
    const state = store.getSnapshot();
    expect(state.statuses["a"]).toMatchObject({ isStreaming: true, blocked: true });
    expect(state.sessions.find((session) => session.id === "a")?.name).toBe("Renamed");
    expect(state.sessions[0]?.id).toBe("c");
  });

  it("replays events that arrive while the snapshot is in flight", async () => {
    let release = () => {};
    const api = await machine({ holdListing: new Promise((resolve) => { release = resolve; }) });
    const store = start(api);
    await new Promise((resolve) => setTimeout(resolve, 100));
    api.emit({ type: "session.pinned", sessionId: "a", cwd: "/code/forgerie", pinned: true });
    release();
    await until(store, () => store.getSnapshot().connection.type === "ready");
    expect(store.getSnapshot().sessions.find((session) => session.id === "a")?.pinned).toBe(true);
  });

  it("keeps rows through a drop, then re-reads the whole catalog", async () => {
    const api = await machine();
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "ready");
    api.setListing({ sessions: [{ id: "z", cwd: "/code/forgerie", name: "After restart", modified: "2026-09-29T18:39:00.000Z" }], statuses: [], activities: [] });
    api.drop();
    await until(store, () => store.getSnapshot().connection.type === "reconnecting");
    expect(store.getSnapshot().sessions.map((session) => session.id)).toEqual(["a", "b"]);
    await until(store, () => store.getSnapshot().connection.type === "ready" && store.getSnapshot().sessions[0]?.id === "z");
    expect(api.reads()).toBe(2);
  });

  it("pins, archives, restores, and deletes through the server, and shows each result", async () => {
    const api = await machine();
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "ready");
    const a = { id: "a", cwd: "/code/forgerie" };
    const find = (id: string) => store.getSnapshot().sessions.find((session) => session.id === id);
    await store.setPinned(a, true);
    expect(find("a")?.pinned).toBe(true);
    await store.setPinned(a, false);
    await store.setArchived(a, true);
    expect(find("a")).toMatchObject({ archived: true, pinned: false });
    await store.setArchived(a, false);
    expect(find("a")?.archived).toBe(false);
    await store.deleteArchived({ id: "b", cwd: "/code/forgerie" });
    expect(find("b")).toBeUndefined();
    expect(api.writes).toEqual([
      { path: "/api/sessions/a/pin", body: { cwd: "/code/forgerie" } },
      { path: "/api/sessions/a/unpin", body: { cwd: "/code/forgerie" } },
      { path: "/api/sessions/a/archive", body: { cwd: "/code/forgerie" } },
      { path: "/api/sessions/a/restore", body: { cwd: "/code/forgerie" } },
      { path: "/api/sessions/bulk/delete-archived", body: { sessions: [{ id: "b", cwd: "/code/forgerie" }] } },
    ]);
  });

  it("rejects with the server's reason and leaves the catalog unchanged", async () => {
    const api = await machine();
    api.refuse("/api/sessions/a/archive", 400, { error: "Stop current session activity before archiving" });
    api.refuse("/api/sessions/a/restore", 404, { error: "Session not found" });
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "ready");
    const a = { id: "a", cwd: "/code/forgerie" };
    await expect(store.setArchived(a, true)).rejects.toMatchObject({ message: "Stop current session activity before archiving", status: 400 });
    await expect(store.setArchived(a, false)).rejects.toMatchObject({ status: 404 });
    expect(store.getSnapshot().sessions.find((session) => session.id === "a")?.archived).toBeUndefined();
  });

  it("treats a per-session failure in the bulk delete reply as a refusal", async () => {
    const api = await machine();
    api.refuse("/api/sessions/bulk/delete-archived", 200, { deleted: true, deletedSessionIds: [], failures: [{ sessionId: "b", error: "Archived session not found" }], generatedAt: "now" });
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "ready");
    await expect(store.deleteArchived({ id: "b", cwd: "/code/forgerie" })).rejects.toMatchObject({ message: "Archived session not found", status: 404 });
    expect(store.getSnapshot().sessions.map((session) => session.id)).toEqual(["a", "b"]);
  });

  it("keeps a confirmed archive when an older snapshot lands after it", async () => {
    let release = () => {};
    const api = await machine();
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "ready");
    // The next join reads the catalog before the archive, and its reply is held.
    api.holdListing(new Promise<void>((resolve) => { release = resolve; }));
    api.drop();
    await until(store, () => store.getSnapshot().connection.type === "reconnecting");
    await vi.waitFor(() => { expect(api.reads()).toBe(2); });
    await store.setArchived({ id: "a", cwd: "/code/forgerie" }, true);
    release();
    await until(store, () => store.getSnapshot().connection.type === "ready");
    expect(store.getSnapshot().sessions.find((session) => session.id === "a")?.archived).toBe(true);
  });

  it("fails visibly on a catalog it cannot read, and does not retry", async () => {
    const api = await machine({ badListing: true });
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "failed");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(api.reads()).toBe(1);
  });
});
