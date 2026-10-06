import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore, type SessionTransport } from "./sessionStore";
import type { SessionStatus } from "./contracts";
import type { SessionTreeSnapshot } from "./sessionTree";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const tree: SessionTreeSnapshot = {
  nodes: [
    { id: "u1", parentId: null, kind: "user", summary: "First question", timestamp: "2026-10-05T10:00:00.000Z" },
    { id: "a1", parentId: "u1", kind: "assistant", summary: "First answer" },
    { id: "u2", parentId: "a1", kind: "user", summary: "Second question", label: "checkpoint" },
  ],
  activeLeafId: "u2", activePathIds: ["u1", "a1", "u2"],
};
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function until(predicate: () => boolean) { await expect.poll(predicate, { timeout: 2000 }).toBe(true); }

async function treeServer(timing: { requestTimeoutMs?: number; treeActionTimeoutMs?: number } = {}) {
  const requests: { path: string; body: unknown }[] = [];
  const state = {
    historyReads: 0,
    history: [{ role: "user", content: "Second question", timestamp: 3 }] as unknown[],
    navigateReply: { cancelled: false, editorText: "First question" } as unknown,
    navigateCode: 200,
    forkReply: { cancelled: false, session: { id: "fork-1", cwd: "/work tree", name: "Forked" }, promptDraft: "Second question" } as unknown,
    navigateGate: undefined as ReturnType<typeof gate> | undefined,
  };
  const ws = new WebSocketServer({ noServer: true });
  const http = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push({ path: url.pathname, body });
    const send = (data: unknown, code = 200) => { response.writeHead(code, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
    if (url.pathname.endsWith("/messages")) { state.historyReads++; send({ messages: state.history, start: 0, total: state.history.length }); }
    else if (url.pathname.endsWith("/stream-snapshot")) send({ seq: 0, partial: null });
    else if (url.pathname.endsWith("/status")) send(idle);
    else if (url.pathname.endsWith("/commands/run")) send({ type: "tree", tree });
    else if (url.pathname.endsWith("/tree/navigate")) {
      await state.navigateGate?.promise;
      send(state.navigateCode === 200 ? state.navigateReply : { error: "The session changed since /tree was opened." }, state.navigateCode);
    } else if (url.pathname.endsWith("/tree/fork")) send(state.forkReply);
    else if (url.pathname.endsWith("/abort")) send({ aborted: true, restoredMessages: [] });
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
    state.navigateGate?.resolve();
    for (const socket of ws.clients) socket.terminate();
    ws.close(); http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  const store = createSessionStore("test", transport, { retryDelayMs: 10, ...timing }, { id: "test", cwd: "/work tree" });
  cleanup.push(store.dispose);
  await store.start();
  await until(() => store.getSnapshot().connection.type === "ready");
  return { state, store, requests };
}
const posts = (requests: { path: string; body: unknown }[], suffix: string) => requests.filter((request) => request.path.endsWith(suffix));

describe("session tree navigation", () => {
  it("opens /tree as a navigator, not as a command result", async () => {
    const { store } = await treeServer();
    await store.send("/tree");
    const snapshot = store.getSnapshot();
    expect(snapshot.tree).toEqual({ type: "open", tree, operation: { type: "idle" } });
    expect(snapshot.commandResult).toBeUndefined();
  });

  it("continues from an entry against the tree it showed, then reloads the branch and returns the editor text", async () => {
    const { store, state, requests } = await treeServer();
    await store.openTree();
    const readsBefore = state.historyReads;
    state.history = [{ role: "user", content: "First question", timestamp: 1 }];
    const outcome = await store.continueTree("u1", { mode: "custom", instructions: "keep the API notes" });
    expect(posts(requests, "/tree/navigate").map((request) => request.body)).toEqual([{
      cwd: "/work tree", targetId: "u1", expectedLeafId: "u2", summary: { mode: "custom", instructions: "keep the API notes" },
    }]);
    expect(outcome).toEqual({ type: "continued", editorText: "First question" });
    expect(store.getSnapshot().tree).toEqual({ type: "closed" });
    await until(() => state.historyReads > readsBefore && store.getSnapshot().connection.type === "ready");
    await until(() => store.getSnapshot().transcript.messages.length === 1);
  });

  it("keeps the navigator open and names a cancelled navigation", async () => {
    const { store, state } = await treeServer();
    await store.openTree();
    state.navigateReply = { cancelled: true, aborted: true };
    expect(await store.continueTree("u1", { mode: "default" })).toEqual({ type: "unchanged" });
    expect(store.getSnapshot().tree).toMatchObject({ type: "open", operation: { type: "idle", notice: { tone: "status", message: expect.stringMatching(/^Summarization cancelled/u) } } });
  });

  it("never retries a failed navigation and shows the server's reason", async () => {
    const { store, state, requests } = await treeServer();
    await store.openTree();
    state.navigateCode = 409;
    expect(await store.continueTree("u1", { mode: "none" })).toEqual({ type: "unchanged" });
    expect(posts(requests, "/tree/navigate")).toHaveLength(1);
    expect(store.getSnapshot().tree).toMatchObject({ type: "open", operation: { type: "idle",
      notice: { tone: "error", message: "The session changed since /tree was opened." } } });
  });

  it("waits for a summary longer than an ordinary request may take", async () => {
    const { store, state } = await treeServer({ requestTimeoutMs: 50, treeActionTimeoutMs: 2000 });
    await store.openTree();
    state.navigateGate = gate();
    const pending = store.continueTree("u1", { mode: "default" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    state.navigateGate.resolve();
    expect(await pending).toEqual({ type: "continued", editorText: "First question" });
  });

  it("re-reads the history after any failed action, and warns when the reply can hide a move", async () => {
    const { store, state } = await treeServer();
    await store.openTree();
    state.navigateCode = 502;
    let reads = state.historyReads;
    expect(await store.continueTree("u1", { mode: "none" })).toEqual({ type: "unchanged" });
    expect(store.getSnapshot().tree).toMatchObject({ operation: { notice: { tone: "error", message: expect.stringContaining("may have changed") } } });
    await until(() => state.historyReads > reads);
    await until(() => store.getSnapshot().connection.type === "ready");

    state.navigateCode = 409;
    reads = state.historyReads;
    await store.continueTree("u1", { mode: "none" });
    expect(store.getSnapshot().tree).toMatchObject({ operation: { notice: { message: "The session changed since /tree was opened." } } });
    await until(() => state.historyReads > reads);
  });

  it("forks from an entry and hands back the new session with its draft", async () => {
    const { store, requests } = await treeServer();
    await store.openTree();
    const outcome = await store.forkTree("u2");
    expect(posts(requests, "/tree/fork").map((request) => request.body)).toEqual([{ cwd: "/work tree", entryId: "u2", expectedLeafId: "u2" }]);
    expect(outcome).toEqual({ type: "forked", session: { id: "fork-1", cwd: "/work tree", name: "Forked" }, promptDraft: "Second question" });
    expect(store.getSnapshot().tree).toEqual({ type: "closed" });
  });

  it("can stop only a running summary, and cannot close while an action runs", async () => {
    const { store, state, requests } = await treeServer();
    await store.openTree();
    state.navigateGate = gate();
    const plain = store.continueTree("u1", { mode: "none" });
    await until(() => posts(requests, "/tree/navigate").length === 1);
    expect(store.getSnapshot().tree).toMatchObject({ operation: { type: "continuing", summarizing: false } });
    await store.abortTree();
    store.closeTree();
    expect(posts(requests, "/abort")).toHaveLength(0);
    expect(store.getSnapshot().tree.type).toBe("open");
    state.navigateReply = { cancelled: true };
    state.navigateGate.resolve();
    await plain;

    state.navigateGate = gate();
    const summarized = store.continueTree("u1", { mode: "default" });
    await until(() => posts(requests, "/tree/navigate").length === 2);
    await store.abortTree();
    expect(posts(requests, "/abort")).toHaveLength(1);
    expect(store.getSnapshot().tree).toMatchObject({ operation: { type: "continuing", summarizing: true, aborting: true } });
    state.navigateReply = { cancelled: true, aborted: true };
    state.navigateGate.resolve();
    await summarized;
    store.closeTree();
    expect(store.getSnapshot().tree).toEqual({ type: "closed" });
  });
});
