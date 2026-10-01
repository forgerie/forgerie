import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore, NotSentError, type SessionTransport } from "./sessionStore";
import type { OperationEvent, SessionStatus } from "./contracts";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const streaming: SessionStatus = { ...idle, isStreaming: true };
async function until(predicate: () => boolean) { await expect.poll(predicate, { timeout: 2000 }).toBe(true); }

/** A Forgerie session API that queues like Pi: follow-ups and steers wait in status until the run ends. */
async function queueServer(initial: SessionStatus) {
  const requests: { path: string; body: unknown }[] = [];
  const state = { status: initial, seq: 0, dropAcknowledgment: false };
  const ws = new WebSocketServer({ noServer: true });
  const http = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push({ path: url.pathname, body });
    const send = (data: unknown, code = 200) => { response.writeHead(code, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
    if (url.pathname.endsWith("/messages")) send({ messages: [{ role: "user", content: "existing", timestamp: 1 }], start: 0, total: 1 });
    else if (url.pathname.endsWith("/stream-snapshot")) send({ seq: state.seq, partial: null });
    else if (url.pathname.endsWith("/prompt")) {
      if (state.dropAcknowledgment) { response.destroy(); return; }
      send({ accepted: true });
    } else if (url.pathname.endsWith("/queue/clear")) {
      state.status = { ...state.status, queuedMessages: [] }; send(state.status);
    } else if (url.pathname.endsWith("/abort")) {
      const restoredMessages = state.status.queuedMessages;
      state.status = idle;
      send({ aborted: true, restoredMessages });
    } else if (url.pathname.endsWith("/status")) send(state.status);
    else if (url.pathname.endsWith("/commands")) send([]);
    else send({ error: "Unexpected endpoint" }, 404);
  });
  http.on("upgrade", (request, socket, head) => ws.handleUpgrade(request, socket, head, () => {}));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const origin = `http://127.0.0.1:${address.port}`;
  const transport: SessionTransport = {
    request: (path, init) => fetch(origin + path, init), connect: (path) => new WebSocket(origin.replace("http:", "ws:") + path),
  };
  cleanup.push(async () => {
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
  const prompts = () => requests.filter(({ path }) => path.endsWith("/prompt")).map(({ body }) => body);
  await store.start();
  return { state, store, requests, prompts, emit };
}

describe("sending while the session works", () => {
  it("sends an idle prompt exactly as before, without a streaming behavior", async () => {
    const api = await queueServer(idle);
    await api.store.send("hello");
    expect(api.prompts()).toEqual([{ cwd: "/work tree", text: "hello" }]);
  });

  it("queues a follow-up during a response, and steers only when asked", async () => {
    const api = await queueServer(streaming);
    await api.store.send("add tests after this");
    await api.store.send("use the existing helper", undefined, { steer: true });
    expect(api.prompts()).toEqual([
      { cwd: "/work tree", text: "add tests after this", streamingBehavior: "followUp" },
      { cwd: "/work tree", text: "use the existing helper", streamingBehavior: "steer" },
    ]);
  });

  it("queues a follow-up behind compaction but refuses a steer that would wait for it", async () => {
    const api = await queueServer({ ...idle, isCompacting: true });
    await api.store.send("continue after compaction");
    await expect(api.store.send("change course", undefined, { steer: true })).rejects.toBeInstanceOf(NotSentError);
    expect(api.prompts()).toEqual([{ cwd: "/work tree", text: "continue after compaction", streamingBehavior: "followUp" }]);
  });

  it("sends an ordinary prompt beside a shell command, without a queue behavior", async () => {
    // Pi queues only during streaming or compaction, so it starts this prompt at once.
    const api = await queueServer({ ...idle, isBashRunning: true });
    await api.store.send("hello");
    expect(api.prompts()).toEqual([{ cwd: "/work tree", text: "hello" }]);
  });

  it("does not send a text Pi would ignore as already queued, and says so", async () => {
    const api = await queueServer({ ...streaming, queuedMessages: [{ kind: "followUp", text: "add tests" }] });
    const refused = api.store.send("add tests");
    await expect(refused).rejects.toBeInstanceOf(NotSentError);
    await expect(refused).rejects.toThrow("This message is already queued.");
    await api.store.send("add more tests");
    expect(api.prompts()).toEqual([{ cwd: "/work tree", text: "add more tests", streamingBehavior: "followUp" }]);
  });

  it("refuses attachments on a queued message, because Stop could only return its text", async () => {
    const api = await queueServer(streaming);
    const image = { kind: "image" as const, mimeType: "image/png", data: "aGk=" };
    await expect(api.store.send("see this", [image])).rejects.toBeInstanceOf(NotSentError);
    expect(api.prompts()).toEqual([]);
  });

  it("does not retry a queued message whose acknowledgement was lost", async () => {
    const api = await queueServer(streaming);
    api.state.dropAcknowledgment = true;
    const sent = api.store.send("maybe queued");
    await expect(sent).rejects.toThrow();
    await expect(sent).rejects.not.toBeInstanceOf(NotSentError);
    expect(api.prompts()).toHaveLength(1);
  });

  it("follows the server queue as it changes, and Stop returns steers and follow-ups in delivery order", async () => {
    const api = await queueServer(streaming);
    const queuedMessages = [{ kind: "steer" as const, text: "use the helper" }, { kind: "followUp" as const, text: "add tests" }];
    api.emit({ type: "status.update", status: { ...streaming, queuedMessages } });
    await until(() => api.store.getSnapshot().status?.queuedMessages.length === 2);
    expect(await api.store.cancel()).toEqual(queuedMessages);
    await until(() => !api.store.getSnapshot().transcript.isRunning);
    expect(api.store.getSnapshot().status?.queuedMessages).toEqual([]);
  });

  it("clears the whole queue without stopping the run", async () => {
    const api = await queueServer({ ...streaming, queuedMessages: [{ kind: "followUp", text: "add tests" }] });
    await api.store.clearQueue();
    expect(api.store.getSnapshot().status?.queuedMessages).toEqual([]);
    expect(api.store.getSnapshot().transcript.isRunning).toBe(true);
    expect(api.requests.some(({ path }) => path.endsWith("/abort"))).toBe(false);
  });
});
