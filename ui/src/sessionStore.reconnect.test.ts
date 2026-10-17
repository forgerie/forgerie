import { openFixture } from "./testing/openFixture";
import { respondToConnectionChecks } from "../../src/server/realtime/connectionHealth";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserTransport, createSessionStore, type SessionStore, type SessionTransport } from "./sessionStore";
import type { PiMessage, SessionEvent } from "./contracts";
import { messageText } from "./transcript";

const disposals: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const user = (text: string, timestamp: number): PiMessage => ({ role: "user", content: text, timestamp });
const answer = (text: string, timestamp: number): PiMessage => ({ role: "assistant", content: text, timestamp });

async function recoveryServer() {
  const state = {
    history: [user("before", 1), answer("history answer", 2)],
    partial: null as PiMessage | null, seq: 0, running: false,
    connections: 0, histories: 0, prompts: 0, failures: 0, rejectSockets: 0, checks: 0, slashCommands: 0,
    slashGate: undefined as ReturnType<typeof deferred> | undefined,
    readFailureStatus: 503, gate: undefined as ReturnType<typeof deferred> | undefined,
    ignoreAbort: false,
  };
  let socket: ServerSocket | undefined;
  let wake: (() => void) | undefined;
  let watching = false;
  const ws = new WebSocketServer({ noServer: true });
  const http = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const send = (body: unknown, status = 200) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (path === "/api/sessiond/runtime") { send({ component: "sessiond", label: "Session daemon", available: true, capabilities: ["session.prompt.requestIds"] }); return; }
    if (path.endsWith("/prompt")) { state.prompts++; send({ error: "Request outcome unknown" }, 503); return; }
    if (path === "/api/sessions/all") { send({ sessions: [{ id: "known", cwd: "/test", name: "Recovery test" }] }); return; }
    if (path.endsWith("/commands")) { send([]); return; }
    if (path.endsWith("/commands/run")) { state.slashCommands++; await state.slashGate?.promise; send({ type: "done", message: "Command completed" }); return; }
    if (state.failures > 0) { state.failures--; send({ error: "Temporarily unavailable" }, state.readFailureStatus); return; }
    if (path.endsWith("/open")) {
      state.histories++;
      await state.gate?.promise;
      const history = state.history.slice();
      send(openFixture({ session: { id: "known", cwd: "/test", name: "Recovery test" }, page: { messages: history, start: 0, total: history.length }, snapshot: { partial: state.partial, seq: state.seq }, status: { isStreaming: state.running, isCompacting: false, isBashRunning: false } })); return;
    }
    if (path.endsWith("/messages")) {
      state.histories++;
      const history = state.history.slice();
      await state.gate?.promise;
      send({ messages: history, start: 0, total: history.length });
    } else if (path.endsWith("/stream-snapshot")) { send({ partial: state.partial, seq: state.seq }); }
    else if (path.endsWith("/status")) { send({ isStreaming: state.running, isCompacting: false, isBashRunning: false }); }
    else send({ error: "Not found" }, 404);
  });
  http.on("upgrade", (request, stream, head) => {
    state.connections++;
    if (state.rejectSockets > 0) { state.rejectSockets--; stream.destroy(); return; }
    ws.handleUpgrade(request, stream, head, (client) => {
      socket = client; respondToConnectionChecks(client);
      client.on("message", () => { state.checks++; });
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const origin = `http://127.0.0.1:${address.port}`;
  const transport: SessionTransport = {
    request: (path, init) => fetch(origin + path, state.ignoreAbort ? { ...init, signal: undefined } : init),
    connect: (path) => new WebSocket(origin.replace("http:", "ws:") + path),
    watchRecovery: (recover) => { wake = recover; watching = true; return () => { watching = false; }; },
  };
  disposals.push(async () => {
    state.gate?.resolve(); state.slashGate?.resolve();
    for (const client of ws.clients) client.terminate();
    ws.close();
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  const store = createSessionStore("known", transport, { retryDelayMs: 10, maxRetryDelayMs: 20 });
  disposals.push(store.dispose);
  const emit = (event: SessionEvent) => {
    if (event.type === "message.end" && event.message !== undefined) {
      const index = state.history.findIndex(message => message.role === event.message?.role && message.timestamp === event.message.timestamp);
      if (index < 0) state.history.push(event.message); else state.history[index] = event.message;
    }
    if (event.type === "tool.end") state.history.push({ role: "toolResult", toolCallId: event.toolCallId, toolName: event.toolName, content: [{ type: "text", text: event.text }], isError: event.isError });
    for (const client of ws.clients) client.send(Buffer.from(JSON.stringify(event)));
  };
  return { state, store, transport, emit, emitRaw: (payload: string) => socket?.send(Buffer.from(payload)),
    close: () => socket?.terminate(), wake: () => wake?.(), watching: () => watching };
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Recovery did not settle");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function ready(store: SessionStore) { return store.getSnapshot().connection.type === "ready"; }
function texts(store: SessionStore) { return store.getSnapshot().transcript.messages.map(messageText); }

describe("resuming a server-owned run", () => {
  it("reattaches after a page reload without sending or restarting the prompt", async () => {
    const api = await recoveryServer();
    api.state.partial = { role: "assistant", content: [
      { type: "thinking", thinking: "initial reasoning" }, { type: "text", text: "partial answer" },
    ], timestamp: 3 };
    api.state.seq = 40;
    api.state.running = true;
    await api.store.start();
    expect(texts(api.store).at(-1)).toBe("partial answer");
    api.store.dispose();
    // The server owns the run and continues producing without the old reader.
    api.state.partial = { role: "assistant", content: [
      { type: "thinking", thinking: "initial reasoning" }, { type: "text", text: "partial answer continues" },
    ], timestamp: 3 };
    api.state.seq = 42;
    const reloaded = createSessionStore("known", api.transport);
    disposals.push(reloaded.dispose);
    await reloaded.start();
    expect(reloaded.getSnapshot().transcript.isRunning).toBe(true);
    expect(texts(reloaded)).toEqual(["before", "history answer", "partial answer continues"]);
    api.emit({ type: "assistant.delta", text: " live", seq: 43 });
    await until(() => texts(reloaded).at(-1) === "partial answer continues live");
    api.emit({ type: "message.end", message: answer("partial answer continues live", 3), seq: 44 });
    api.emit({ type: "agent.end", seq: 45 });
    await until(() => !reloaded.getSnapshot().transcript.isRunning);
    expect(texts(reloaded)).toEqual(["before", "history answer", "partial answer continues live"]);
    expect(api.state.prompts).toBe(0);
  });

  it("lets an independent tab attach to the same run without owning or cancelling it", async () => {
    const api = await recoveryServer();
    api.state.partial = { role: "assistant", content: "shared partial", timestamp: 3 };
    api.state.seq = 10;
    api.state.running = true;
    await api.store.start();
    const follower = createSessionStore("known", api.transport);
    disposals.push(follower.dispose);
    await follower.start();
    api.emit({ type: "assistant.delta", text: " for both", seq: 11 });
    await until(() => texts(api.store).at(-1) === "shared partial for both" && texts(follower).at(-1) === "shared partial for both");
    api.store.dispose();
    api.emit({ type: "assistant.delta", text: " after the first tab closes", seq: 12 });
    await until(() => texts(follower).at(-1)?.endsWith("after the first tab closes") === true);
    api.emit({ type: "message.end", message: answer("shared partial for both after the first tab closes", 3), seq: 13 });
    api.emit({ type: "agent.end", seq: 14 });
    await until(() => !follower.getSnapshot().transcript.isRunning);
    expect(follower.getSnapshot().transcript.messages).toHaveLength(3);
    expect(api.state.prompts).toBe(0);
  });

  it("recovers a tool result covered by the snapshot while joining a running session", async () => {
    const api = await recoveryServer();
    api.state.history.push({ role: "assistant", timestamp: 3, content: [
      { type: "toolCall", id: "read-join", name: "read", arguments: { path: "file.ts" } },
    ] });
    api.state.running = true;
    api.state.gate = deferred();
    const started = api.store.start();
    await until(() => api.state.histories === 1);
    api.emit({ type: "tool.end", toolCallId: "read-join", toolName: "read", text: "joined result", isError: false, seq: 1 });
    api.emit({ type: "assistant.delta", text: "next partial", seq: 2 });
    api.state.partial = { role: "assistant", content: "next partial", timestamp: 4 };
    api.state.seq = 2;
    api.state.gate.resolve();
    await started;
    expect(api.store.getSnapshot().transcript.messages.flatMap((message) => message.parts).filter((part) => part.type === "tool"))
      .toEqual([expect.objectContaining({ id: "read-join", state: { type: "done", output: "joined result", isError: false } })]);
    expect(texts(api.store)).toEqual(["before", "history answer", "", "next partial"]);
    api.emit({ type: "assistant.delta", text: " live", seq: 3 });
    await until(() => texts(api.store).at(-1) === "next partial live");
    expect(api.state.prompts).toBe(0);
  });
});

describe("automatic connection recovery", () => {
  it("does not interrupt a healthy session when returning from an image picker", async () => {
    const api = await recoveryServer();
    const documentEvents = new EventTarget();
    const windowEvents = new EventTarget();
    let visibilityState = "visible";
    Object.defineProperty(documentEvents, "visibilityState", { get: () => visibilityState });
    vi.stubGlobal("document", documentEvents);
    vi.stubGlobal("window", windowEvents);
    disposals.push(() => { vi.unstubAllGlobals(); });
    const store = createSessionStore("known", { ...api.transport, watchRecovery: browserTransport.watchRecovery, checkConnection: browserTransport.checkConnection });
    disposals.push(store.dispose);
    await store.start();
    const connections: string[] = [];
    disposals.push(store.subscribe(() => connections.push(store.getSnapshot().connection.type)));
    visibilityState = "hidden";
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    visibilityState = "visible";
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    expect(store.getSnapshot().connection.type).toBe("ready");
    expect(connections).not.toContain("reconnecting");
    await until(() => api.state.checks === 1);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(api.state.connections).toBe(1);
    expect(connections).not.toContain("reconnecting");
  });

  it("does not cancel a running slash command when a healthy connection passes a wake check", async () => {
    const api = await recoveryServer();
    api.state.slashGate = deferred();
    const store = createSessionStore("known", { ...api.transport, checkConnection: browserTransport.checkConnection });
    disposals.push(store.dispose);
    await store.start();
    const command = store.send("/probe");
    await until(() => api.state.slashCommands === 1);
    api.wake();
    await until(() => api.state.checks === 1);
    expect(store.getSnapshot().connection.type).toBe("ready");
    expect(store.getSnapshot().sending).toBe(true);
    api.state.slashGate.resolve();
    await command;
    expect(store.getSnapshot().commandError).toBeUndefined();
    expect(api.state.connections).toBe(1);
  });
  it("retains history while disconnected and recovers work completed offline without sending a prompt", async () => {
    const api = await recoveryServer();
    await api.store.start();
    const oldIds = api.store.getSnapshot().transcript.messages.map((message) => message.id);
    api.state.history.push(user("offline question", 3), answer("offline answer", 4));
    api.state.seq = 20;
    api.close();
    await until(() => api.store.getSnapshot().connection.type === "reconnecting");
    expect(texts(api.store)).toEqual(["before", "history answer"]);
    await until(() => ready(api.store));
    expect(texts(api.store)).toEqual(["before", "history answer", "offline question", "offline answer"]);
    expect(api.store.getSnapshot().transcript.messages.slice(0, 2).map((message) => message.id)).toEqual(oldIds);
    expect(api.state.prompts).toBe(0);
    expect(api.state.connections).toBe(2);
  });

  it("keeps retained message IDs unique when authoritative history changes", async () => {
    const api = await recoveryServer();
    await api.store.start();
    const old = api.store.getSnapshot().transcript.messages;
    api.state.history.unshift(answer("earlier message", 0));
    api.wake();
    await until(() => api.state.connections === 2 && ready(api.store));
    const messages = api.store.getSnapshot().transcript.messages;
    expect(new Set(messages.map((message) => message.id)).size).toBe(messages.length);
    expect(messages.slice(1).map((message) => message.id)).toEqual(old.map((message) => message.id));
  });

  it("joins a new partial with thinking and tools, then accepts lower sequence numbers after a daemon restart", async () => {
    const api = await recoveryServer();
    await api.store.start();
    api.emit({ type: "agent.start", seq: 90 });
    api.emit({ type: "assistant.delta", text: "old partial", seq: 91 });
    await until(() => texts(api.store).at(-1) === "old partial");
    api.state.history.push(user("new run", 3));
    api.state.partial = { role: "assistant", content: [
      { type: "thinking", thinking: "inspect" }, { type: "text", text: "new partial" },
      { type: "toolCall", id: "read-1", name: "read", arguments: { path: "file.ts" } },
    ] };
    api.state.running = true;
    api.state.seq = 1;
    api.close();
    await until(() => api.state.connections === 2 && ready(api.store));
    expect(texts(api.store)).toEqual(["before", "history answer", "new run", "new partial"]);
    api.emit({ type: "tool.start", toolName: "read", toolCallId: "read-1", args: { path: "file.ts" }, seq: 2 });
    api.emit({ type: "tool.end", toolName: "read", toolCallId: "read-1", text: "contents", isError: false, seq: 3 });
    api.emit({ type: "assistant.thinking.delta", text: " again", seq: 4 });
    api.emit({ type: "assistant.delta", text: " done", seq: 5 });
    await until(() => texts(api.store).at(-1) === "new partial\n done");
    const parts = api.store.getSnapshot().transcript.messages.flatMap((message) => message.parts);
    expect(parts.filter((part) => part.type === "tool")).toEqual([
      expect.objectContaining({ id: "read-1", state: { type: "done", output: "contents", isError: false } }),
    ]);
    expect(parts.filter((part) => part.type === "thinking").map((part) => part.text)).toEqual(["inspect", " again"]);
  });

  it("buffers events during recovery, skips covered deltas, and keeps finalized messages before the next partial", async () => {
    const api = await recoveryServer();
    await api.store.start();
    api.state.gate = deferred();
    api.close();
    await until(() => api.state.histories === 2);
    api.emit({ type: "message.end", message: answer("finished during join", 3), seq: 2 });
    api.emit({ type: "assistant.delta", text: "seed", seq: 3 });
    api.state.partial = { role: "assistant", content: "seed" };
    api.state.seq = 3;
    api.state.running = true;
    api.state.gate.resolve();
    await until(() => ready(api.store));
    api.emit({ type: "assistant.delta", text: " live", seq: 4 });
    await until(() => texts(api.store).at(-1) === "seed live");
    expect(texts(api.store)).toEqual(["before", "history answer", "finished during join", "seed live"]);
  });

  it("keeps retrying socket and HTTP failures and ignores work from a superseded join", async () => {
    const api = await recoveryServer();
    api.state.rejectSockets = 2;
    api.state.failures = 2;
    await api.store.start();
    await until(() => ready(api.store));
    expect(api.state.connections).toBe(5);
    api.state.gate = deferred();
    api.state.ignoreAbort = true;
    api.wake();
    await until(() => api.state.histories === 2);
    const oldGate = api.state.gate;
    api.state.gate = undefined;
    api.state.ignoreAbort = false;
    api.state.history.push(answer("fresh state", 3));
    api.wake();
    await until(() => ready(api.store));
    oldGate.resolve();
    expect(texts(api.store)).toEqual(["before", "history answer", "fresh state"]);
    api.emit({ type: "assistant.delta", text: "current socket", seq: 1 });
    await until(() => texts(api.store).at(-1) === "current socket");
    expect(api.state.connections).toBe(7);
  });

  it("uses wake recovery even when a half-open socket has not reported a close", async () => {
    const api = await recoveryServer();
    await api.store.start();
    api.state.history.push(answer("missed answer", 3));
    api.wake();
    await until(() => api.state.connections === 2 && ready(api.store));
    expect(texts(api.store)).toEqual(["before", "history answer", "missed answer"]);
  });

  it("stops on permanent read failures rather than looping forever", async () => {
    const api = await recoveryServer();
    await api.store.start();
    api.state.failures = 1;
    api.state.readFailureStatus = 404;
    api.close();
    await until(() => api.store.getSnapshot().connection.type === "failed");
    expect(api.store.getSnapshot().connection).toMatchObject({ message: "Temporarily unavailable" });
    expect(texts(api.store)).toEqual(["before", "history answer"]);
    api.wake();
    expect(api.state.connections).toBe(2);
  });

  it("settles a run completed offline with one finalized tool result and no stale partial", async () => {
    const api = await recoveryServer();
    await api.store.start();
    api.emit({ type: "agent.start", seq: 1 });
    api.emit({ type: "assistant.delta", text: "Reading", seq: 2 });
    api.emit({ type: "tool.start", toolName: "read", toolCallId: "read-1", args: { path: "file.ts" }, seq: 3 });
    await until(() => api.store.getSnapshot().transcript.messages.flatMap((message) => message.parts).some((part) => part.type === "tool"));
    api.state.history.push({ role: "assistant", timestamp: 3, content: [
      { type: "thinking", thinking: "Read the file" }, { type: "text", text: "Reading" },
      { type: "toolCall", id: "read-1", name: "read", arguments: { path: "file.ts" } },
    ] }, { role: "toolResult", toolCallId: "read-1", toolName: "read", content: "file contents", timestamp: 4 }, answer("Done", 5));
    api.state.seq = 8;
    api.close();
    await until(() => api.state.connections === 2 && ready(api.store));
    expect(api.store.getSnapshot().transcript.isRunning).toBe(false);
    expect(texts(api.store)).toEqual(["before", "history answer", "Reading", "Done"]);
    const tools = api.store.getSnapshot().transcript.messages.flatMap((message) => message.parts).filter((part) => part.type === "tool");
    expect(tools).toEqual([expect.objectContaining({ id: "read-1", state: { type: "done", output: "file contents", isError: false } })]);
  });

  it("cancels scheduled retries on disposal", async () => {
    const api = await recoveryServer();
    await api.store.start();
    api.close();
    await until(() => api.store.getSnapshot().connection.type === "reconnecting");
    api.store.dispose();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(api.state.connections).toBe(1);
  });

  it("stops a malformed stream without applying it or retrying a broken contract", async () => {
    const api = await recoveryServer();
    await api.store.start();
    api.emitRaw('{"type":"assistant.delta","text":42}');
    await until(() => api.store.getSnapshot().connection.type === "failed");
    expect(api.store.getSnapshot().connection).toMatchObject({ message: expect.stringContaining("Invalid session event") });
    expect(texts(api.store)).toEqual(["before", "history answer"]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(api.state.connections).toBe(1);
  });

  it("retries an unknown prompt receipt once, but does not resubmit during reconnect", async () => {
    const api = await recoveryServer();
    await api.store.start();
    await expect(api.store.send("hello")).rejects.toThrow("Request outcome unknown");
    api.close();
    await until(() => api.state.connections === 2 && ready(api.store));
    expect(api.state.prompts).toBe(2);
    expect(api.store.getSnapshot().commandError).toBe("Request outcome unknown");
  });

  it("disposes an outstanding join and wake listeners without opening another socket", async () => {
    const api = await recoveryServer();
    api.state.gate = deferred();
    const started = api.store.start();
    await until(() => api.state.histories === 1);
    api.store.dispose();
    expect(api.watching()).toBe(false);
    api.wake();
    api.state.gate.resolve();
    await started;
    expect(api.state.connections).toBe(1);
    expect(api.store.getSnapshot().connection.type).not.toBe("ready");
  });
});
