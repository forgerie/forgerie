import { createServer } from "node:http";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createCatalogStore, type CatalogStore } from "./catalogStore";
import type { SessionTransport } from "../sessionStore";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

const idle = { isStreaming: false, isCompacting: false, isBashRunning: false };

/** A real HTTP + WebSocket server whose catalog the test can change between joins. */
async function machine(options: { holdListing?: Promise<void>; badListing?: boolean } = {}) {
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
  const sockets = new WebSocketServer({ noServer: true });
  const http = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://x").pathname;
    const send = (body: unknown) => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
    if (path === "/api/sessions/all") {
      reads += 1;
      void (options.holdListing ?? Promise.resolve()).then(() => send(options.badListing ? { sessions: "nope" } : listing));
    } else if (path === "/api/sessions/asks") send(asks);
    else if (path === "/api/sessions/unread") send({ catalogId: "c", catalogRevision: 1, sessions: [] });
    else if (path === "/api/machines/local/projects") send([{ id: "p", name: "forgerie", path: "/code/forgerie" }]);
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

describe("machine catalog", () => {
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

  it("fails visibly on a catalog it cannot read, and does not retry", async () => {
    const api = await machine({ badListing: true });
    const store = start(api);
    await until(store, () => store.getSnapshot().connection.type === "failed");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(api.reads()).toBe(1);
  });
});
