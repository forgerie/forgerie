import { createServer } from "node:http";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore, type SessionStore, type SessionTransport } from "./sessionStore";
import { messageText } from "./transcript";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

async function server(options: { promptFailure?: boolean; unknownSession?: boolean; catalogFailure?: boolean; commandResults?: unknown[] } = {}) {
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
    } else if (url.pathname.endsWith("/commands/run") || url.pathname.endsWith("/commands/respond")) {
      send(options.commandResults?.shift() ?? { type: "done", message: "Command completed" });
    } else if (url.pathname.endsWith("/prompt")) {
      if (options.promptFailure) { send({ error: "Model unavailable" }, 400); return; }
      expect(body).toEqual({ cwd: "/workspace with spaces", text: "hello" });
      send({ accepted: true });
      // Acknowledgement is not completion. Emit the run after the HTTP response.
    } else if (url.pathname.endsWith("/abort")) { send({ aborted: true }); }
    else if (url.searchParams.get("cwd") !== "/workspace with spaces") { send({ error: "cwd required" }, 400); }
    else if (url.pathname.endsWith("/commands")) {
      send(options.catalogFailure ? { error: "Discovery unavailable" } : [{ name: "session", source: "builtin", description: "Session stats" }, { name: "review", source: "prompt" }], options.catalogFailure ? 503 : 200);
    }
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

describe("Pi command transport", () => {
  it("discovers commands for the session and sends plain arguments to commands/run, never prompt", async () => {
    const api = await server();
    const store = createSessionStore("known", api.transport); cleanup.push(store.dispose);
    await store.start();
    await waitFor(store, () => store.getSnapshot().commands.type === "ready");
    expect(store.getSnapshot().commands).toMatchObject({ type: "ready", commands: [{ name: "session" }, { name: "review" }] });
    await store.send("/name Ledger service");
    expect(api.requests.at(-1)).toEqual({ path: "/api/sessions/known/commands/run", body: { cwd: "/workspace with spaces", text: "/name Ledger service" } });
    expect(api.requests.some((request) => request.path.endsWith("/prompt"))).toBe(false);
    expect(store.getSnapshot().commandResult).toEqual({ type: "done", message: "Command completed" });
    expect(store.getSnapshot().transcript.messages).toHaveLength(2);
  });
  it("reports catalog failure without disabling the live session, and can retry", async () => {
    const options = { catalogFailure: true };
    const api = await server(options);
    const store = createSessionStore("known", api.transport); cleanup.push(store.dispose);
    await store.start();
    await waitFor(store, () => store.getSnapshot().commands.type === "failed");
    expect(store.getSnapshot().commands).toEqual({ type: "failed", message: "Discovery unavailable" });
    expect(store.getSnapshot().connection.type).toBe("ready");
    options.catalogFailure = false;
    await store.loadCommands();
    expect(store.getSnapshot().commands.type).toBe("ready");
  });
  it("keeps rejected commands observable without retries or invented transcript messages", async () => {
    const api = await server({ commandResults: [{ type: "unsupported", message: "Unknown command: /bad" }] });
    const store = createSessionStore("known", api.transport); cleanup.push(store.dispose);
    await store.start();
    await expect(store.send("/bad")).rejects.toThrow("Unknown command: /bad");
    expect(store.getSnapshot().commandError).toBe("Unknown command: /bad");
    expect(store.getSnapshot().sending).toBe(false);
    expect(api.requests.filter((request) => request.path.endsWith("/commands/run"))).toHaveLength(1);
    expect(store.getSnapshot().transcript.messages).toHaveLength(2);
  });
  it("responds to the exact selection and returns the new session with its draft", async () => {
    const selection = { type: "select", requestId: "fork-1", title: "Fork from", options: [{ value: "entry-1", label: "First message" }] };
    const done = { type: "done", message: "Session forked", session: { id: "child", cwd: "/workspace with spaces", name: "Child" }, promptDraft: "original question" };
    const api = await server({ commandResults: [selection, done] });
    const store = createSessionStore("known", api.transport); cleanup.push(store.dispose);
    await store.start();
    await store.send("/fork");
    expect(store.getSnapshot().commandResult).toEqual(selection);
    expect(await store.respondToCommand("fork-1", "entry-1")).toEqual(done);
    expect(api.requests.at(-1)).toEqual({ path: "/api/sessions/known/commands/respond", body: { cwd: "/workspace with spaces", requestId: "fork-1", value: "entry-1" } });
    expect(store.getSnapshot().session?.id).toBe("known");
    store.dismissCommand();
    expect(store.getSnapshot().commandResult).toBeUndefined();
  });
  it("updates the current session name and refreshes discovery after reload", async () => {
    const api = await server({ commandResults: [{ type: "done", session: { id: "known", cwd: "/workspace with spaces", name: "Renamed" } }] });
    const store = createSessionStore("known", api.transport); cleanup.push(store.dispose);
    await store.start();
    await waitFor(store, () => store.getSnapshot().commands.type === "ready");
    await store.send("/name Renamed");
    expect(store.getSnapshot().session?.name).toBe("Renamed");
    await store.send("/reload");
    await waitFor(store, () => store.getSnapshot().commands.type === "ready");
    expect(api.requests.filter((request) => request.path.endsWith("/commands"))).toHaveLength(2);
  });
});

describe("session transport", () => {
  it("loads an existing session, sends cwd and text, and streams until agent.end", async () => {
    const api = await server();
    const store = createSessionStore("known", api.transport);
    cleanup.push(store.dispose);
    await store.start();
    expect(store.getSnapshot().connection.type).toBe("ready");
    expect(store.getSnapshot().transcript.messages.map((message) => messageText(message))).toEqual(["before", "history answer"]);
    await store.send("hello");
    api.emit({ type: "agent.start", seq: 1 });
    api.emit({ type: "message.append", message: { role: "user", content: "hello" }, seq: 2 });
    api.emit({ type: "message.end", message: { role: "user", content: "hello", timestamp: 3 }, seq: 3 });
    api.emit({ type: "assistant.delta", text: "Hello", seq: 4 });
    await waitFor(store, () => store.getSnapshot().transcript.messages.map(messageText).at(-1) === "Hello");
    expect(store.getSnapshot().transcript.isRunning).toBe(true);
    api.emit({ type: "message.end", message: { role: "assistant", content: "Hello!", timestamp: 4 }, seq: 5 });
    api.emit({ type: "agent.end", seq: 6 });
    await waitFor(store, () => !store.getSnapshot().transcript.isRunning);
    expect(store.getSnapshot().transcript.messages.map((message) => messageText(message))).toEqual(["before", "history answer", "hello", "Hello!"]);
    await store.cancel();
    expect(api.requests.at(-1)).toEqual({ path: "/api/sessions/known/abort", body: { cwd: "/workspace with spaces" } });
  });
  it("skips the machine catalog when the caller already knows the session", async () => {
    const api = await server();
    const store = createSessionStore("known", api.transport, {}, { id: "known", cwd: "/workspace with spaces", name: "From the picker" });
    cleanup.push(store.dispose);
    // The title is there before any request finishes.
    expect(store.getSnapshot().session?.name).toBe("From the picker");
    await store.start();
    expect(store.getSnapshot().connection.type).toBe("ready");
    expect(api.requests.map((request) => request.path)).not.toContain("/api/sessions/all");
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
    await waitFor(store, () => store.getSnapshot().connection.type === "reconnecting");
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

describe("problems and retry details", () => {
  it("records a failed send as a problem the reader can dismiss", async () => {
    const api = await server({ promptFailure: true });
    const store = createSessionStore("known", api.transport, { now: () => 1000 }); cleanup.push(store.dispose);
    await store.start();
    await expect(store.send("hello")).rejects.toThrow("Model unavailable");
    expect(store.getSnapshot().problems).toEqual([{ id: 1, title: "Message may not have sent", at: 1000,
      message: "Model unavailable Pi did not take the message. It is back in the message box." }]);
    store.dismissProblem(1);
    expect(store.getSnapshot().problems).toEqual([]);
  });
  it("makes no problem of a refusal before any request", async () => {
    const api = await server();
    const store = createSessionStore("known", api.transport); cleanup.push(store.dispose);
    await store.start();
    await expect(store.send("!", [])).rejects.toThrow("Type a command after !.");
    await expect(store.send("/name x", [{ type: "image", data: "", mimeType: "image/png" }] as never)).rejects.toThrow("Remove attachments");
    expect(store.getSnapshot().problems).toEqual([]);
  });
  it("records each new error Pi reports once, newest first", async () => {
    const api = await server();
    const store = createSessionStore("known", api.transport); cleanup.push(store.dispose);
    await store.start();
    api.emit({ type: "session.error", message: "529 overloaded", seq: 1 });
    await waitFor(store, () => store.getSnapshot().problems.length === 1);
    api.emit({ type: "agent.start", seq: 2 });
    api.emit({ type: "session.error", message: "529 overloaded", seq: 3 });
    api.emit({ type: "session.error", message: "Compaction failed", seq: 4 });
    await waitFor(store, () => store.getSnapshot().problems.length === 2);
    expect(store.getSnapshot().problems.map((problem) => [problem.title, problem.message]))
      .toEqual([["Pi reported an error", "Compaction failed"], ["Pi reported an error", "529 overloaded"]]);
    store.dismissProblems();
    expect(store.getSnapshot().problems).toEqual([]);
  });
  it("counts tries, says when the next starts, and can try now", async () => {
    const api = await server();
    let clock = 5000;
    const store = createSessionStore("known", api.transport, { now: () => clock, retryDelayMs: 60_000 }); cleanup.push(store.dispose);
    await store.start();
    expect(store.getSnapshot().lastReadyAt).toBe(5000);
    clock = 9000;
    api.close();
    await waitFor(store, () => store.getSnapshot().connection.type === "reconnecting");
    expect(store.getSnapshot().connection).toEqual({ type: "reconnecting", message: "Live connection closed.", attempt: 1, retryAt: 69_000 });
    store.retryNow();
    expect(store.getSnapshot().connection).toEqual({ type: "reconnecting", message: "Trying again now.", attempt: 2, retryAt: 9000 });
    await waitFor(store, () => store.getSnapshot().connection.type === "ready");
    expect(store.getSnapshot().lastReadyAt).toBe(9000);
  });
});
