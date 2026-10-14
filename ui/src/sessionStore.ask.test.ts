import { openFixture } from "./testing/openFixture";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore, type SessionTransport } from "./sessionStore";
import type { AskEvent, PendingAsk } from "./contracts";

const disposals: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });
const ask = (askId: string): PendingAsk => ({ askId, askedAt: "2026-09-29T00:00:00Z",
  questions: [{ id: "db", question: "Which database?", options: [{ value: "pg", label: "Postgres" }] }] });

/** A real HTTP and WebSocket server whose open ask and close replies are configurable. */
async function askServer() {
  const state = {
    pendingAsk: undefined as PendingAsk | undefined,
    /** What the next close reply does: close the ask, report a stale race, or fail. */
    closeBehavior: "closed" as "closed" | "stale" | "fail",
    /** Held close replies, so a test can observe the sending phase. */
    hold: undefined as Promise<void> | undefined,
    closes: [] as { path: string; body: unknown }[],
  };
  let socket: ServerSocket | undefined;
  const ws = new WebSocketServer({ noServer: true });
  const http = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const send = (body: unknown, status = 200) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const status = () => ({ isStreaming: false, isCompacting: false, isBashRunning: false,
      ...(state.pendingAsk ? { pendingAsk: state.pendingAsk } : {}) });
    if (new URL(request.url ?? "/", "http://localhost").pathname.endsWith("/open")) {
      send(openFixture({ session: { id: "known", cwd: new URL(request.url ?? "/", "http://localhost").searchParams.get("cwd") ?? "/workspace" },
        page: { messages: [], start: 0, total: ([]).length }, snapshot: { seq: 0, partial: null }, status: status() })); return;
    }
    if (url.pathname === "/api/sessions/all") send({ sessions: [{ id: "known", cwd: "/work" }] });
    else if (url.pathname.includes("/ask/")) {
      state.closes.push({ path: url.pathname, body: JSON.parse(Buffer.concat(chunks).toString()) });
      await state.hold;
      if (state.closeBehavior === "fail") { send({ error: "Tree navigation is active" }, 409); return; }
      if (state.closeBehavior === "closed") state.pendingAsk = undefined;
      send({ result: state.closeBehavior, sessionStatus: status() });
    } else if (url.pathname.endsWith("/messages")) send({ messages: [], start: 0, total: 0 });
    else if (url.pathname.endsWith("/stream-snapshot")) send({ partial: null, seq: 0 });
    else if (url.pathname.endsWith("/status")) send(status());
    else send({ error: "Not found" }, 404);
  });
  http.on("upgrade", (request, stream, head) => ws.handleUpgrade(request, stream, head, (client) => { socket = client; }));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const origin = `http://127.0.0.1:${address.port}`;
  const transport: SessionTransport = {
    request: (path, init) => fetch(origin + path, init),
    connect: (path) => new WebSocket(origin.replace("http:", "ws:") + path),
  };
  disposals.push(async () => {
    for (const client of ws.clients) client.terminate();
    ws.close(); http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  const store = createSessionStore("known", transport, { retryDelayMs: 10, maxRetryDelayMs: 20 });
  disposals.push(store.dispose);
  let seq = 0;
  const emit = (event: AskEvent) => socket?.send(Buffer.from(JSON.stringify({ ...event, seq: ++seq })));
  return { state, store, emit, drop: () => socket?.terminate() };
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("State did not settle");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("ask_user in the session store", () => {
  it("rehydrates an open ask from status and follows live open and close events", async () => {
    const api = await askServer();
    api.state.pendingAsk = ask("a");
    await api.store.start();
    expect(api.store.getSnapshot().ask).toEqual({ type: "open", ask: ask("a"), phase: { type: "answering" } });
    api.emit({ type: "ask.closed", askId: "a", reason: "answered-in-chat" });
    await until(() => api.store.getSnapshot().ask.type === "none");
    api.emit({ type: "ask.opened", ask: ask("b") });
    await until(() => openId() === "b");
    // A supersede announces the old close first; a late close of the old ask changes nothing.
    api.emit({ type: "ask.closed", askId: "a", reason: "superseded" });
    api.emit({ type: "ask.opened", ask: ask("c") });
    await until(() => openId() === "c");
    function openId() {
      const current = api.store.getSnapshot().ask;
      return current.type === "open" ? current.ask.askId : undefined;
    }
  });

  it("keeps the form open while sending, then closes it from the server's reply", async () => {
    const api = await askServer();
    api.state.pendingAsk = ask("a");
    await api.store.start();
    let release!: () => void;
    api.state.hold = new Promise((resolve) => { release = resolve; });
    const sent = api.store.submitAsk([{ id: "db", values: ["pg"] }]);
    await until(() => api.state.closes.length === 1);
    expect(api.store.getSnapshot().ask).toMatchObject({ type: "open", phase: { type: "sending", action: "submit" } });
    expect(api.state.closes[0]).toEqual({ path: "/api/sessions/known/ask/submit",
      body: { cwd: "/work", askId: "a", answers: [{ id: "db", values: ["pg"] }] } });
    release(); await sent;
    expect(api.store.getSnapshot().ask).toEqual({ type: "none" });
  });

  it("dismisses with cwd and ask ID only", async () => {
    const api = await askServer();
    api.state.pendingAsk = ask("a");
    await api.store.start();
    await api.store.dismissAsk();
    expect(api.state.closes).toEqual([{ path: "/api/sessions/known/ask/cancel", body: { cwd: "/work", askId: "a" } }]);
    expect(api.store.getSnapshot().ask.type).toBe("none");
  });

  it("adopts the newer ask a stale reply names", async () => {
    const api = await askServer();
    api.state.pendingAsk = ask("a");
    await api.store.start();
    api.state.closeBehavior = "stale";
    api.state.pendingAsk = ask("b");
    await api.store.submitAsk([]);
    expect(api.store.getSnapshot().ask).toEqual({ type: "open", ask: ask("b"), phase: { type: "answering" } });
  });

  it("keeps the ask open with the server's error and does not retry", async () => {
    const api = await askServer();
    api.state.pendingAsk = ask("a");
    await api.store.start();
    api.state.closeBehavior = "fail";
    await api.store.submitAsk([{ id: "db", values: ["pg"] }]);
    expect(api.store.getSnapshot().ask).toMatchObject({ type: "open", phase: { type: "answering", error: "Tree navigation is active" } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.state.closes).toHaveLength(1);
  });

  it("keeps the open ask through a reconnect and learns what changed while offline", async () => {
    const api = await askServer();
    api.state.pendingAsk = ask("a");
    await api.store.start();
    const before = api.store.getSnapshot().ask;
    api.drop();
    await until(() => api.store.getSnapshot().connection.type === "reconnecting");
    expect(api.store.getSnapshot().ask).toBe(before);
    await until(() => api.store.getSnapshot().connection.type === "ready");
    expect(api.store.getSnapshot().ask).toBe(before);
    api.state.pendingAsk = undefined; // Answered in another browser while this one was offline.
    api.drop();
    await until(() => api.store.getSnapshot().connection.type === "reconnecting");
    await until(() => api.store.getSnapshot().connection.type === "ready");
    expect(api.store.getSnapshot().ask.type).toBe("none");
  });

  it("does not send while disconnected", async () => {
    const api = await askServer();
    api.state.pendingAsk = ask("a");
    await api.store.start();
    api.drop();
    await until(() => api.store.getSnapshot().connection.type === "reconnecting");
    await api.store.submitAsk([]);
    expect(api.state.closes).toHaveLength(0);
  });
});
