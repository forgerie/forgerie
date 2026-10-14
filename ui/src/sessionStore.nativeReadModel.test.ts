import { openFixture } from "./testing/openFixture";
import type { ServerResponse } from "node:http";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore, type SessionTransport, type SessionStore } from "./sessionStore";
import type { DurableBrowserSnapshot, SessionOpen } from "./contracts";
import { messageText } from "./transcript";

const disposals: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

async function fixture() {
  const requests: string[] = [];
  let seed: SessionOpen | undefined;
  const waiting: ServerResponse[] = [];
  const transientEvents: SessionOpen["snapshot"]["transientEvents"] = [];
  let socket: ServerSocket | undefined;
  let connections = 0;
  const ws = new WebSocketServer({ noServer: true });
  const http = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    requests.push(path);
    if (path.endsWith("/open")) {
      if (seed === undefined) waiting.push(response);
      else { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(seed)); }
      return;
    }
    response.writeHead(path.endsWith("/commands") ? 200 : 503, { "Content-Type": "application/json" });
    response.end(JSON.stringify(path.endsWith("/commands") ? [] : { error: "Native joins must not read separate seeds" }));
  });
  http.on("upgrade", (request, stream, head) => {
    expect(new URL(request.url ?? "/", "http://localhost").searchParams.get("native")).toBe("1");
    ws.handleUpgrade(request, stream, head, (client) => { socket = client; connections++; seed = undefined; });
  });
  await new Promise<void>((resolve) => { http.listen(0, "127.0.0.1", resolve); });
  const address = http.address();
  if (address === null || typeof address === "string") throw new Error("No test port");
  const origin = `http://127.0.0.1:${address.port}`;
  const transport: SessionTransport = { nativeReadModel: true, request: (path, init) => fetch(origin + path, init),
    connect: (path) => new WebSocket(origin.replace("http:", "ws:") + path) };
  const store = createSessionStore("native", transport, { retryDelayMs: 5 }, { id: "native", cwd: "/temporary" });
  disposals.push(async () => {
    for (const client of ws.clients) client.terminate();
    ws.close(); http.closeAllConnections();
    await new Promise<void>((resolve) => { http.close(() => { resolve(); }); });
  });
  disposals.push(store.dispose);
  return { store, requests, connections: () => connections,
    emit: (frame: unknown) => {
      if (typeof frame === "object" && frame !== null && "type" in frame && frame.type === "session.snapshot") {
        const value = frame as DurableBrowserSnapshot;
        seed = openFixture({ session: { id: "native", cwd: "/temporary" }, readPath: "native", epoch: value.epoch,
          page: { ...value.history, total: Math.max(value.history.total, value.history.start + value.history.messages.length) },
          snapshot: { seq: value.revision * 10, partial: value.partial }, tools: value.tools, transientEvents,
          status: { isStreaming: value.isStreaming, isCompacting: value.isCompacting, isBashRunning: transientEvents.some(event => event.type === "shell.start"), queuedMessages: value.queuedMessages, pendingAsk: value.app?.pendingAsk } });
        for (const response of waiting.splice(0)) { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(seed)); }
        socket?.send(JSON.stringify({ type: "session.open", open: seed }));
      } else {
        if (typeof frame === "object" && frame !== null && "type" in frame && typeof frame.type === "string" && frame.type.startsWith("shell.")) transientEvents.push(frame as SessionOpen["snapshot"]["transientEvents"][number]);
        socket?.send(JSON.stringify(frame));
      }
    }, close: () => socket?.close() };
}

function waitFor(store: SessionStore, predicate: () => boolean) {
  if (predicate()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error("Native state did not settle")); }, 2000);
    const unsubscribe = store.subscribe(() => { if (predicate()) { clearTimeout(timeout); unsubscribe(); resolve(); } });
  });
}

function snapshot(revision = 0, epoch = "one"): DurableBrowserSnapshot {
  return { type: "session.snapshot", epoch, revision, history: { start: 0, total: 2, messages: [
    { id: "journal:entry:0", role: "user", content: "first contribution", timestamp: 1 },
    { id: "journal:entry:1", role: "user", content: "second contribution", timestamp: 1 },
  ] }, partial: null, tools: [], queuedMessages: [], isStreaming: false, isCompacting: false, app: { response: { kind: "none" } } };
}

async function join(f: Awaited<ReturnType<typeof fixture>>, frame = snapshot()) {
  const starting = f.store.start();
  // A store remains loading until its native socket publishes the complete seed.
  await new Promise<void>((resolve, reject) => {
    const tick = setInterval(() => { if (f.connections() === 1) { clearInterval(tick); clearTimeout(timeout); resolve(); } }, 5);
    const timeout = setTimeout(() => { clearInterval(tick); reject(new Error("No native socket")); }, 2000);
  });
  f.emit(frame);
  await starting;
  expect(f.store.getSnapshot().connection.type).toBe("ready");
}

describe("native browser replacement", () => {
  it("joins from one HTTP open seed plus the socket without separate history, partial, or status reads", async () => {
    const f = await fixture();
    await join(f);
    await waitFor(f.store, () => f.store.getSnapshot().commands.type === "ready");
    expect(f.requests).toEqual(["/api/sessions/native/open", "/api/sessions/native/commands"]);
    expect(f.store.getSnapshot().transcript.messages.map(messageText)).toEqual(["first contribution", "second contribution"]);
  });

  it("retains two distinct disclosure identities with equal timestamps and ignores duplicate revisions and SDK deltas", async () => {
    const f = await fixture();
    await join(f);
    const ids = f.store.getSnapshot().transcript.messages.map((message) => message.id);
    f.emit({ ...snapshot(1), history: { ...snapshot().history, messages: [...snapshot().history.messages, { id: "new", role: "assistant", content: "new committed answer", timestamp: 2 }], total: 3 } });
    await waitFor(f.store, () => f.store.getSnapshot().transcript.messages.length === 3);
    expect(f.store.getSnapshot().transcript.messages.slice(0, 2).map((message) => message.id)).toEqual(ids);
    expect(new Set(f.store.getSnapshot().transcript.messages.map((message) => message.id)).size).toBe(3);
    f.emit({ type: "assistant.delta", text: "not authority", seq: 100 });
    f.emit(snapshot(1));
    f.emit(snapshot(0));
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(f.store.getSnapshot().transcript.messages.map(messageText)).toEqual(["first contribution", "second contribution", "new committed answer"]);
  });

  it("reconciles current tools and ask ID while retaining unsaved running shell output", async () => {
    const f = await fixture();
    const frame = snapshot();
    frame.isStreaming = true;
    frame.history.messages.push({ id: "tool-message", role: "assistant", content: [{ type: "toolCall", id: "call", name: "read", arguments: {} }] });
    frame.tools = [{ toolCallId: "call", toolName: "read", status: "running", output: "saved progress" }];
    frame.app = { response: { kind: "needs-response", reason: "questions" }, pendingAsk: { askId: "ask-one", askedAt: "now", questions: [{ id: "q", question: "Choose", options: [] }] } };
    await join(f, frame);
    expect(f.store.getSnapshot().ask).toMatchObject({ type: "open", ask: { askId: "ask-one" } });
    expect(f.store.getSnapshot().transcript.messages.at(-1)?.parts).toMatchObject([{ type: "tool", state: { type: "running", output: "saved progress" } }]);
    f.emit({ type: "shell.start", command: "pending command", seq: 1 });
    f.emit({ type: "shell.chunk", chunk: "unsaved output", seq: 2 });
    await waitFor(f.store, () => f.store.getSnapshot().transcript.messages.some((message) => message.role === "shell"));
    f.emit({ ...frame, revision: 1, app: { response: { kind: "none" } } });
    await waitFor(f.store, () => f.store.getSnapshot().ask.type === "none");
    expect(f.store.getSnapshot().transcript.messages.at(-1)?.parts).toMatchObject([{ type: "shell", run: { result: { type: "running", output: "unsaved output" } } }]);
  });

  it("accepts a fresh reconnect epoch without replaying the old connection's effects", async () => {
    const f = await fixture();
    await join(f);
    const ids = f.store.getSnapshot().transcript.messages.map((message) => message.id);
    f.close();
    await waitFor(f.store, () => f.store.getSnapshot().connection.type === "reconnecting");
    await new Promise<void>((resolve, reject) => {
      const tick = setInterval(() => { if (f.connections() === 2) { clearInterval(tick); clearTimeout(timeout); resolve(); } }, 5);
      const timeout = setTimeout(() => { clearInterval(tick); reject(new Error("No reconnect")); }, 2000);
    });
    f.emit(snapshot(0, "new-daemon"));
    await waitFor(f.store, () => f.store.getSnapshot().connection.type === "ready");
    expect(f.store.getSnapshot().transcript.messages.map((message) => message.id)).toEqual(ids);
    expect(f.requests.filter(path => path.endsWith("/open"))).toHaveLength(2);
    expect(f.requests.every((path) => path.endsWith("/commands") || path.endsWith("/open"))).toBe(true);
  });
});
