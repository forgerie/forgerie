import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore, type SessionStore, type SessionTransport } from "./sessionStore";
import type { OperationEvent, SessionStatus } from "./contracts";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const queued: SessionStatus = { ...idle, isStreaming: true, queuedMessages: [{ kind: "followUp", text: "/compact preserve tests" }] };
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function until(predicate: () => boolean) { await expect.poll(predicate, { timeout: 2000 }).toBe(true); }

async function compactionServer(initial: SessionStatus = idle) {
  const requests: { path: string; body: unknown }[] = [];
  const state = { status: initial, seq: 0, statusReads: 0, historyReads: 0,
    historyGate: undefined as ReturnType<typeof gate> | undefined,
    statusGate: undefined as ReturnType<typeof gate> | undefined,
    commandGate: undefined as ReturnType<typeof gate> | undefined,
    commandResult: { type: "done", message: "Compaction queued…" } as unknown,
    beforeCommandReply: undefined as (() => void) | undefined,
    clearFailure: false, dropAcknowledgment: false };
  const ws = new WebSocketServer({ noServer: true });
  const http = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push({ path: url.pathname, body });
    const send = (data: unknown, code = 200) => { response.writeHead(code, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
    if (url.pathname.endsWith("/messages")) { state.historyReads++; await state.historyGate?.promise; send({ messages: [{ role: "user", content: "existing", timestamp: 1 }], start: 0, total: 1 }); }
    else if (url.pathname.endsWith("/stream-snapshot")) send({ seq: state.seq, partial: null });
    else if (url.pathname.endsWith("/prompt")) send({ accepted: true });
    else if (url.pathname.endsWith("/commands/run")) {
      state.beforeCommandReply?.();
      await state.commandGate?.promise;
      if (state.dropAcknowledgment) response.destroy();
      else send(state.commandResult);
    } else if (url.pathname.endsWith("/queue/clear")) {
      if (state.clearFailure) { send({ error: "Queue could not be cleared" }, 503); return; }
      state.status = { ...state.status, queuedMessages: [] }; send(state.status);
    } else if (url.pathname.endsWith("/abort")) {
      const restoredMessages = state.status.queuedMessages;
      state.status = idle;
      send({ aborted: true, restoredMessages });
    } else if (url.pathname.endsWith("/status")) {
      state.statusReads++;
      const snapshot = state.status;
      await state.statusGate?.promise;
      send(snapshot);
    } else if (url.pathname.endsWith("/commands")) send([]);
    else send({ error: "Unexpected endpoint" }, 404);
  });
  http.on("upgrade", (request, socket, head) => ws.handleUpgrade(request, socket, head, () => {}));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const origin = `http://127.0.0.1:${address.port}`;
  let recover: (() => void) | undefined;
  const transport: SessionTransport = {
    request: (path, init) => fetch(origin + path, init), connect: (path) => new WebSocket(origin.replace("http:", "ws:") + path),
    watchRecovery: (callback) => { recover = callback; return () => { recover = undefined; }; },
  };
  cleanup.push(async () => {
    state.statusGate?.resolve(); state.commandGate?.resolve(); state.historyGate?.resolve();
    for (const socket of ws.clients) socket.terminate();
    ws.close(); http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  const store = createSessionStore("test", transport, { retryDelayMs: 10 }, { id: "test", cwd: "/work tree" });
  cleanup.push(store.dispose);
  const emit = (event: OperationEvent) => {
    if (event.type === "status.update") state.status = event.status;
    for (const socket of ws.clients) socket.send(JSON.stringify({ ...event, seq: ++state.seq }));
  };
  return { state, store, requests, emit, wake: () => recover?.(), transport };
}
const ready = (store: SessionStore) => store.getSnapshot().connection.type === "ready";

describe("compaction transport and recovery", () => {
  it("reads queued instructions, sends exactly one explicit command while running, and never restarts the run", async () => {
    const api = await compactionServer(queued);
    await api.store.start();
    expect(api.store.getSnapshot().compaction).toEqual({ type: "queued", text: "/compact preserve tests" });
    await api.store.send("/compact preserve tests");
    expect(api.requests.filter(({ path }) => path.endsWith("/commands/run"))).toEqual([
      { path: "/api/sessions/test/commands/run", body: { cwd: "/work tree", text: "/compact preserve tests" } },
    ]);
    expect(api.requests.some(({ path }) => path.endsWith("/prompt"))).toBe(false);
    expect(api.store.getSnapshot().transcript.messages).toHaveLength(1);
  });
  it("queues an ordinary message behind a queued compaction as a follow-up, never as a steer", async () => {
    const api = await compactionServer(queued);
    await api.store.start();
    await expect(api.store.send("change course", undefined, { steer: true })).rejects.toThrow("Steering works only");
    await api.store.send("ordinary follow-up");
    expect(api.requests.filter(({ path }) => path.endsWith("/prompt"))).toEqual([
      { path: "/api/sessions/test/prompt", body: { cwd: "/work tree", text: "ordinary follow-up", streamingBehavior: "followUp" } },
    ]);
  });
  it.each([
    ["success", "Compaction complete.\nTokens before: 123\n\nSummary", "complete"],
    ["info", "Compaction cancelled.", "cancelled"],
    ["error", "Compaction failed: Provider unavailable", "failed"],
  ] as const)("shows live compaction and %s feedback without adding transcript messages", async (level, message, outcome) => {
    const api = await compactionServer(); await api.store.start();
    api.emit({ type: "status.update", status: { ...idle, isCompacting: true } });
    await until(() => api.store.getSnapshot().compaction.type === "running");
    expect(api.store.getSnapshot().transcript.isRunning).toBe(true);
    api.emit({ type: "command.output", level, message });
    api.emit({ type: "status.update", status: idle });
    await until(() => api.store.getSnapshot().compaction.type === "finished" && !api.store.getSnapshot().transcript.isRunning);
    expect(api.store.getSnapshot().compaction).toEqual({ type: "finished", outcome, message });
    expect(api.store.getSnapshot().commandResult).toBeUndefined();
    expect(api.store.getSnapshot().transcript.messages).toHaveLength(1);
    api.store.dismissCompaction(); expect(api.store.getSnapshot().compaction).toEqual({ type: "idle" });
  });
  it("keeps a completion received before HTTP acknowledgment instead of replacing it with started feedback", async () => {
    const api = await compactionServer(); await api.store.start();
    api.state.commandGate = gate();
    api.state.beforeCommandReply = () => {
      api.emit({ type: "command.output", level: "success", message: "Compaction complete.\nSummary" });
      api.emit({ type: "status.update", status: idle });
    };
    const sent = api.store.send("/compact");
    await until(() => api.store.getSnapshot().compaction.type === "finished");
    api.state.commandGate.resolve(); await sent;
    await until(() => api.state.statusReads === 2);
    expect(api.store.getSnapshot().compaction).toEqual({ type: "finished", outcome: "complete", message: "Compaction complete.\nSummary" });
  });
  it("preserves failure and does not retry a command with a lost acknowledgment", async () => {
    const api = await compactionServer(); await api.store.start();
    api.state.dropAcknowledgment = true;
    await expect(api.store.send("/compact keep instructions")).rejects.toThrow();
    expect(api.store.getSnapshot().commandError).toBeTruthy();
    expect(api.requests.filter(({ path }) => path.endsWith("/commands/run"))).toHaveLength(1);
  });
  it("clears the entire queue without stopping the active run, and leaves it intact on failure", async () => {
    const api = await compactionServer({ ...queued, queuedMessages: [...queued.queuedMessages, { kind: "followUp", text: "another client's work" }] });
    await api.store.start(); api.state.clearFailure = true;
    await expect(api.store.clearQueue()).rejects.toThrow("Queue could not be cleared");
    expect(api.store.getSnapshot().compaction.type).toBe("queued");
    expect(api.store.getSnapshot().status?.queuedMessages).toHaveLength(2);
    api.state.clearFailure = false; await api.store.clearQueue();
    expect(api.store.getSnapshot().status?.queuedMessages).toEqual([]);
    expect(api.store.getSnapshot().compaction).toMatchObject({ type: "finished", outcome: "cancelled" });
    expect(api.store.getSnapshot().transcript.isRunning).toBe(true);
    expect(api.requests.some(({ path }) => path.endsWith("/abort"))).toBe(false);
  });
  it("returns queued commands for draft restoration when Stop aborts the run", async () => {
    const api = await compactionServer(queued); await api.store.start();
    expect(await api.store.cancel()).toEqual(queued.queuedMessages);
    await until(() => !api.store.getSnapshot().transcript.isRunning);
    expect(api.requests.filter(({ path }) => path.endsWith("/abort"))).toEqual([{ path: "/api/sessions/test/abort", body: { cwd: "/work tree" } }]);
  });
  it("rejoins authoritative queued/running state, then reports unknown rather than success for a missed outcome", async () => {
    const api = await compactionServer(queued); await api.store.start();
    api.state.status = { ...idle, isCompacting: true }; api.state.seq = 100; api.wake();
    await until(() => ready(api.store) && api.store.getSnapshot().compaction.type === "running");
    api.state.status = idle; api.state.seq = 0; api.wake();
    await until(() => ready(api.store) && api.store.getSnapshot().compaction.type === "finished");
    expect(api.store.getSnapshot().compaction).toMatchObject({ outcome: "unknown" });
    api.emit({ type: "command.output", level: "success", message: "Compaction complete." });
    await until(() => { const value = api.store.getSnapshot().compaction; return value.type === "finished" && value.outcome === "complete"; });
    expect(api.requests.some(({ path }) => path.endsWith("/commands/run"))).toBe(false);
  });
  it("keeps status events newer than an in-flight GET",  async () => {
    const api = await compactionServer({ ...idle, isCompacting: true });
    api.state.statusGate = gate();
    const starting = api.store.start();
    await until(() => api.state.statusReads === 1);
    api.emit({ type: "command.output", level: "success", message: "Compaction complete.\nJoined summary" });
    api.emit({ type: "status.update", status: idle });
    api.state.statusGate.resolve(); await starting;
    expect(api.store.getSnapshot().compaction).toMatchObject({ type: "finished", outcome: "complete" });
    expect(api.store.getSnapshot().transcript.isRunning).toBe(false);
  });
  it("keeps buffered completion below the transcript watermark instead of treating it as persisted history", async () => {
    const api = await compactionServer(); api.state.historyGate = gate();
    const starting = api.store.start(); await until(() => api.state.historyReads === 1);
    api.emit({ type: "command.output", level: "success", message: "Compaction complete.\nSummary before snapshot" });
    api.emit({ type: "status.update", status: { ...idle, isCompacting: true } });
    // The GET is newer than this buffered status. Its idle value must win.
    api.state.status = idle;
    api.state.historyGate.resolve(); await starting;
    expect(api.store.getSnapshot().compaction).toMatchObject({ type: "finished", outcome: "complete", message: "Compaction complete.\nSummary before snapshot" });
    expect(api.store.getSnapshot().transcript.isRunning).toBe(false);
    expect(api.store.getSnapshot().transcript.messages).toHaveLength(1);
  });
  it("does not overwrite a newer live status with a slow post-command refresh", async () => {
    const api = await compactionServer(); await api.store.start(); api.state.statusGate = gate();
    await api.store.send("/compact"); await until(() => api.state.statusReads === 2);
    api.emit({ type: "status.update", status: queued });
    await until(() => api.store.getSnapshot().compaction.type === "queued");
    api.state.statusGate.resolve();
    await until(() => api.store.getSnapshot().sending === false);
    expect(api.store.getSnapshot().compaction.type).toBe("queued");
  });
  it("exposes non-compaction command output as feedback",   async () => {
    const api = await compactionServer(); await api.store.start();
    api.emit({ type: "command.output", level: "info", message: "Export complete" });
    await until(() => api.store.getSnapshot().commandResult?.type === "done");
    expect(api.store.getSnapshot().commandResult).toEqual({ type: "done", message: "Export complete" });
  });
});
