import { openFixture } from "./testing/openFixture";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionStore, type SessionTransport } from "./sessionStore";
import { createReadTracker } from "./readReceipt";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
async function fixture(holdHistory = false) {
  const requests: { path: string; body: unknown }[] = [];
  let order = 7;
  let notify: ((id: string) => void) | undefined;
  let client: ServerSocket | undefined;
  let releaseHistory = () => {};
  const historyReady = holdHistory ? new Promise<void>((resolve) => { releaseHistory = resolve; }) : Promise.resolve();
  const sockets = new WebSocketServer({ noServer: true });
  const catalog = () => ({ catalogId: "epoch", sessions: [{ sessionId: "known", cwd: "/workspace", completionOrder: order }] });
  const http = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    requests.push({ path, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined });
    const send = (data: unknown) => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
    if (path === "/api/sessions/all") send({ sessions: [{ id: "known", cwd: "/workspace" }] });
    else if (path === "/api/sessions/unread" || path.endsWith("/unread/acknowledge")) send(catalog());
    else if (path.endsWith("/open")) { const captured = order; await historyReady; send(openFixture({
      page: { messages: [{ role: "assistant", content: [{ type: "text", text: "Visible answer" }] }], start: 0, total: 1 },
      receipt: { catalogId: "epoch", throughCompletionOrder: captured } })); }
    else if (path.endsWith("/messages")) { await historyReady; send({ messages: [{ role: "assistant", content: [{ type: "text", text: "Visible answer" }] }], start: 0, total: 1 }); }
    else if (path.endsWith("/stream-snapshot")) send({ partial: null, seq: 0 });
    else if (path.endsWith("/status")) send({ isStreaming: false, isCompacting: false, isBashRunning: false });
    else if (path.endsWith("/commands")) send([]);
    else { response.writeHead(404); response.end(); }
  });
  http.on("upgrade", (request, socket, head) => sockets.handleUpgrade(request, socket, head, (connection) => { client = connection; }));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  const origin = `http://127.0.0.1:${address.port}`;
  const transport: SessionTransport = { request: (path, init) => fetch(origin + path, init), connect: (path) => new WebSocket(origin.replace("http:", "ws:") + path) };
  const reads = createReadTracker(transport, { isVisible: () => true, subscribe: (listener) => { notify = listener; return () => { notify = undefined; }; } });
  cleanup.push(async () => { releaseHistory(); client?.terminate(); sockets.close(); await new Promise<void>((resolve) => http.close(() => resolve())); });
  return { requests, transport, reads, releaseHistory, complete: (announce = true) => { order++; if (announce) notify?.("known"); }, announce: () => notify?.("known"), observing: () => notify !== undefined };
}
const acknowledgements = (requests: { path: string; body: unknown }[]) => requests.filter((request) => request.path.endsWith("/unread/acknowledge"));
describe("reading the active conversation", () => {
  it("captures before history, acknowledges after history, and does not acknowledge a newer completion", async () => {
    const api = await fixture(true);
    const store = createSessionStore("known", api.transport, {}, undefined, api.reads); cleanup.push(store.dispose); store.setVisible(true);
    store.setVisible(true);
    const starting = store.start();
    await vi.waitFor(() => expect(api.requests.some((request) => request.path.endsWith("/open"))).toBe(true));
    expect(acknowledgements(api.requests)).toHaveLength(0);
    api.complete(false); api.releaseHistory();
    await starting;
    await vi.waitFor(() => expect(acknowledgements(api.requests).length).toBeGreaterThanOrEqual(1));
    expect(acknowledgements(api.requests)[0]?.body).toEqual({ cwd: "/workspace", catalogId: "epoch", throughCompletionOrder: 7 });
    expect(api.requests.filter(request => request.path === "/api/sessions/unread")).toHaveLength(0);
    expect(api.requests.filter(request => request.path.endsWith("/open"))).toHaveLength(1);
    expect(store.getSnapshot().transcript.messages).toHaveLength(1);
    api.announce();
    await vi.waitFor(() => expect(acknowledgements(api.requests).at(-1)?.body).toMatchObject({ throughCompletionOrder: 8 }));
  });
  it("recovers a completion notification that arrives while the initial history is loading", async () => {
    const api = await fixture(true);
    const store = createSessionStore("known", api.transport, {}, undefined, api.reads); cleanup.push(store.dispose); store.setVisible(true);
    store.setVisible(true);
    const starting = store.start();
    await vi.waitFor(() => expect(api.requests.some((request) => request.path.endsWith("/open"))).toBe(true));
    api.complete(); api.releaseHistory(); await starting;
    await vi.waitFor(() => expect(acknowledgements(api.requests).at(-1)?.body).toMatchObject({ throughCompletionOrder: 8 }));
  });
  it("does not mark an abandoned history load as read and removes its unread observer", async () => {
    const api = await fixture(true);
    const store = createSessionStore("known", api.transport, {}, undefined, api.reads);
    store.setVisible(true);
    const starting = store.start();
    await vi.waitFor(() => expect(api.requests.some((request) => request.path.endsWith("/open"))).toBe(true));
    store.dispose(); api.releaseHistory(); await starting;
    expect(acknowledgements(api.requests)).toHaveLength(0);
    expect(api.observing()).toBe(false);
  });
  it("reloads and acknowledges newly completed work in the visible conversation", async () => {
    const api = await fixture();
    const store = createSessionStore("known", api.transport, {}, undefined, api.reads); cleanup.push(store.dispose); store.setVisible(true);
    await store.start();
    await vi.waitFor(() => expect(acknowledgements(api.requests)).toHaveLength(1));
    api.complete();
    await vi.waitFor(() => expect(acknowledgements(api.requests)).toHaveLength(2));
    expect(acknowledgements(api.requests)[1]?.body).toMatchObject({ throughCompletionOrder: 8 });
  });
});
