import { createServer } from "node:http";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore, type SessionStore, type SessionTransport } from "./sessionStore";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

async function server(options: { promptFailure?: boolean; unknownSession?: boolean } = {}) {
  const requests: { path: string; body: unknown }[] = [];
  let client: ServerSocket | undefined;
  const sockets = new WebSocketServer({ noServer: true });
  const http = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push({ path: url.pathname, body });
    const send = (data: unknown, status = 200) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(data));
    };
    if (url.pathname === "/api/sessions/all") {
      send({ sessions: options.unknownSession ? [] : [{ id: "known", cwd: "/workspace with spaces", name: "Existing conversation" }] });
    } else if (url.pathname.endsWith("/prompt")) {
      if (options.promptFailure) { send({ error: "Model unavailable" }, 400); return; }
      expect(body).toEqual({ cwd: "/workspace with spaces", text: "hello" });
      send({ accepted: true });
      // Acknowledgement is not completion. Emit the run after the HTTP response.
    } else if (url.pathname.endsWith("/abort")) { send({ aborted: true }); }
    else if (url.searchParams.get("cwd") !== "/workspace with spaces") { send({ error: "cwd required" }, 400); }
    else if (url.pathname.endsWith("/messages")) {
      send({ messages: [{ role: "user", content: "before", timestamp: 1 }, { role: "assistant", content: [{ type: "text", text: "history answer" }], timestamp: 2 }], start: 0, total: 2 });
    } else if (url.pathname.endsWith("/stream-snapshot")) { send({ partial: null, seq: 0 }); }
    else if (url.pathname.endsWith("/status")) { send({ isStreaming: false, isCompacting: false, isBashRunning: false }); }
    else send({ error: "not found" }, 404);
  });
  http.on("upgrade", (request, socket, head) => sockets.handleUpgrade(request, socket, head, (connection) => { client = connection; }));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const origin = `http://127.0.0.1:${address.port}`;
  const transport: SessionTransport = {
    request: (path, init) => fetch(origin + path, init),
    connect: (path) => new WebSocket(origin.replace("http:", "ws:") + path),
  };
  cleanup.push(async () => {
    client?.terminate(); sockets.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  return { transport, requests, emit: (event: unknown) => client?.send(Buffer.from(JSON.stringify(event))), close: () => client?.close() };
}
function waitFor(store: SessionStore, predicate: () => boolean) {
  if (predicate()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error("State did not settle")); }, 2000);
    const unsubscribe = store.subscribe(() => {
      if (predicate()) { clearTimeout(timeout); unsubscribe(); resolve(); }
    });
  });
}

describe("session transport", () => {
  it("loads an existing session, sends cwd and text, and streams until agent.end", async () => {
    const api = await server();
    const store = createSessionStore("known", api.transport);
    cleanup.push(store.dispose);
    await store.start();
    expect(store.getSnapshot().connection.type).toBe("ready");
    expect(store.getSnapshot().transcript.messages.map((message) => message.text)).toEqual(["before", "history answer"]);
    await store.send("hello");
    api.emit({ type: "agent.start", seq: 1 });
    api.emit({ type: "message.append", message: { role: "user", content: "hello" }, seq: 2 });
    api.emit({ type: "message.end", message: { role: "user", content: "hello", timestamp: 3 }, seq: 3 });
    api.emit({ type: "assistant.delta", text: "Hello", seq: 4 });
    await waitFor(store, () => store.getSnapshot().transcript.messages.at(-1)?.text === "Hello");
    expect(store.getSnapshot().transcript.isRunning).toBe(true);
    api.emit({ type: "message.end", message: { role: "assistant", content: "Hello!", timestamp: 4 }, seq: 5 });
    api.emit({ type: "agent.end", seq: 6 });
    await waitFor(store, () => !store.getSnapshot().transcript.isRunning);
    expect(store.getSnapshot().transcript.messages.map((message) => message.text)).toEqual(["before", "history answer", "hello", "Hello!"]);
    await store.cancel();
    expect(api.requests.at(-1)).toEqual({ path: "/api/sessions/known/abort", body: { cwd: "/workspace with spaces" } });
  });
  it("exposes a rejected prompt without inventing a sent user message", async () => {
    const api = await server({ promptFailure: true });
    const store = createSessionStore("known", api.transport); cleanup.push(store.dispose);
    await store.start();
    await expect(store.send("hello")).rejects.toThrow("Model unavailable");
    expect(store.getSnapshot().commandError).toBe("Model unavailable");
    expect(store.getSnapshot().sending).toBe(false);
    expect(store.getSnapshot().transcript.messages).toHaveLength(2);
  });
  it("blocks sending after a disconnect", async () => {
    const api = await server();
    const store = createSessionStore("known", api.transport); cleanup.push(store.dispose);
    await store.start(); api.close();
    await waitFor(store, () => store.getSnapshot().connection.type === "failed");
    await expect(store.send("hello")).rejects.toThrow("not connected");
    expect(api.requests.some((request) => request.path.endsWith("prompt"))).toBe(false);
  });
  it("reports an unknown session before opening a socket", async () => {
    const api = await server({ unknownSession: true });
    const store = createSessionStore("missing", api.transport); cleanup.push(store.dispose);
    await store.start();
    expect(store.getSnapshot().connection).toMatchObject({ type: "failed", message: expect.stringContaining("not found") });
  });
});
