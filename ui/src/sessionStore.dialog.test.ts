import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore, type SessionTransport } from "./sessionStore";
import type { OperationEvent, PendingDialog, SessionStatus } from "./contracts";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
const confirm: PendingDialog = { dialogId: "d1", kind: "confirm", title: "Delete the branch?", message: "This cannot be undone.", askedAt: "2026-10-05T12:00:00Z" };
const select: PendingDialog = { dialogId: "d2", kind: "select", title: "Pick a target", options: ["staging", "production"], askedAt: "2026-10-05T12:00:01Z" };
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
async function until(predicate: () => boolean) { await expect.poll(predicate, { timeout: 2000 }).toBe(true); }

/** A Forgerie session API whose extension dialogs close like the daemon's. */
async function dialogServer(initial: PendingDialog[]) {
  const requests: { path: string; body: unknown }[] = [];
  const state = { dialogs: initial, seq: 0, failNext: undefined as undefined | "invalid" | "drop" | "stale" };
  const status = (): SessionStatus => ({ ...idle, ...(state.dialogs.length ? { pendingDialogs: state.dialogs } : {}) });
  const ws = new WebSocketServer({ noServer: true });
  const http = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push({ path: url.pathname, body });
    const send = (data: unknown, code = 200) => { response.writeHead(code, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
    if (url.pathname.endsWith("/messages")) send({ messages: [], start: 0, total: 0 });
    else if (url.pathname.endsWith("/stream-snapshot")) send({ seq: state.seq, partial: null });
    else if (url.pathname.endsWith("/status")) send(status());
    else if (url.pathname.endsWith("/commands")) send([]);
    // An extension command answers only when its handler ends, here after the user answers a dialog.
    else if (url.pathname.endsWith("/commands/run")) setTimeout(() => send({ type: "done" }), 200);
    else if (url.pathname.includes("/dialogs/")) {
      const failure = state.failNext; state.failNext = undefined;
      if (failure === "drop") { response.destroy(); return; }
      if (failure === "invalid") { send({ error: "Answer must be one of the offered options" }, 400); return; }
      const { dialogId } = body as { dialogId: string };
      if (failure === "stale") { state.dialogs = state.dialogs.filter((item) => item.dialogId !== dialogId); send({ result: "stale", sessionStatus: status() }); return; }
      state.dialogs = state.dialogs.filter((item) => item.dialogId !== dialogId);
      send({ result: "closed", sessionStatus: status() });
    } else send({ error: "Unexpected endpoint" }, 404);
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
  const store = createSessionStore("test", transport, { retryDelayMs: 10, requestTimeoutMs: 100 }, { id: "test", cwd: "/work tree" });
  cleanup.push(store.dispose);
  const emit = (event: OperationEvent) => {
    for (const socket of ws.clients) socket.send(JSON.stringify({ ...event, seq: ++state.seq }));
  };
  const mutations = () => requests.filter(({ path }) => path.includes("/dialogs/")).map(({ path, body }) => ({ path: path.replace("/api/sessions/test/", ""), body }));
  await store.start();
  return { state, store, emit, status, mutations };
}
const open = (store: Awaited<ReturnType<typeof dialogServer>>["store"]) => store.getSnapshot().status?.pendingDialogs?.map((item) => item.dialogId) ?? [];

describe("extension dialogs", () => {
  it("reads open dialogs from status, oldest first, and follows live status", async () => {
    const api = await dialogServer([confirm]);
    expect(open(api.store)).toEqual(["d1"]);
    api.emit({ type: "status.update", status: { ...idle, pendingDialogs: [confirm, select] } });
    await until(() => open(api.store).length === 2);
    expect(open(api.store)).toEqual(["d1", "d2"]);
  });

  it("skips a dialog of a kind this client does not know, and keeps the rest", async () => {
    const api = await dialogServer([confirm]);
    api.emit({ type: "status.update", status: { ...idle, pendingDialogs: [{ ...select, kind: "editor" } as unknown as PendingDialog, select] } });
    await until(() => open(api.store).join() === "d2");
  });

  it("answers and cancels through the daemon, and shows the status it returns", async () => {
    const api = await dialogServer([confirm, select]);
    await api.store.answerDialog("d1", true);
    expect(open(api.store)).toEqual(["d2"]);
    await api.store.cancelDialog("d2");
    expect(open(api.store)).toEqual([]);
    expect(api.mutations()).toEqual([
      { path: "dialogs/answer", body: { cwd: "/work tree", dialogId: "d1", value: true } },
      { path: "dialogs/cancel", body: { cwd: "/work tree", dialogId: "d2" } },
    ]);
    expect(api.store.getSnapshot().dialogPhase).toEqual({ type: "answering" });
  });

  it("treats a dialog another window closed first as an ordinary race", async () => {
    const api = await dialogServer([confirm]);
    api.state.failNext = "stale";
    await api.store.answerDialog("d1", false);
    expect(open(api.store)).toEqual([]);
    expect(api.store.getSnapshot().dialogPhase).toEqual({ type: "answering" });
  });

  it("keeps the dialog open with the daemon's reason when it refuses an answer", async () => {
    const api = await dialogServer([select]);
    api.state.failNext = "invalid";
    await api.store.answerDialog("d2", "nowhere");
    expect(open(api.store)).toEqual(["d2"]);
    expect(api.store.getSnapshot().dialogPhase).toEqual({ dialogId: "d2", type: "failed", message: "Answer must be one of the offered options" });
  });

  it("never retries an answer whose acknowledgement was lost, and says it may have arrived", async () => {
    const api = await dialogServer([confirm]);
    api.state.failNext = "drop";
    await api.store.answerDialog("d1", true);
    expect(api.mutations()).toHaveLength(1);
    const phase = api.store.getSnapshot().dialogPhase;
    expect(phase.type === "failed" && phase.message).toMatch(/may have reached the extension/);
  });

  it("waits for a command that waits on a dialog, instead of timing it out", async () => {
    const api = await dialogServer([]);
    const running = api.store.send("/deploy");
    api.emit({ type: "status.update", status: { ...idle, pendingDialogs: [confirm] } });
    await until(() => open(api.store).length === 1);
    await api.store.answerDialog("d1", true);
    await expect(running).resolves.toEqual({ type: "done" });
    expect(api.store.getSnapshot().commandError).toBeUndefined();
  });

  it("ignores a second answer while one is on its way", async () => {
    const api = await dialogServer([confirm]);
    await Promise.all([api.store.answerDialog("d1", true), api.store.answerDialog("d1", false)]);
    expect(api.mutations()).toHaveLength(1);
  });
});
