import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore, isBashRunning, shellAvailabilityOf, type SessionTransport } from "./sessionStore";
import type { SessionStatus } from "./contracts";
import type { PromptAttachment } from "./attachments";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
async function until(predicate: () => boolean) { await expect.poll(predicate, { timeout: 2000 }).toBe(true); }

/** A Forgerie API with configurable shell outcomes. */
async function shellServer(options: { status?: SessionStatus; shell?: "accept" | "reject" | "drop"; history?: unknown[] } = {}) {
  const requests: { path: string; body: unknown }[] = [];
  const state = { status: options.status ?? idle, seq: 0 };
  const ws = new WebSocketServer({ noServer: true });
  const http = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push({ path: url.pathname, body });
    const send = (data: unknown, code = 200) => { response.writeHead(code, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
    if (url.pathname.endsWith("/messages")) send({ messages: options.history ?? [], start: 0, total: options.history?.length ?? 0 });
    else if (url.pathname.endsWith("/stream-snapshot")) send({ seq: state.seq, partial: null });
    else if (url.pathname.endsWith("/status")) send(state.status);
    else if (url.pathname.endsWith("/commands")) send([]);
    else if (url.pathname.endsWith("/shell")) {
      if (options.shell === "reject") send({ error: "A bash command is already running" }, 400);
      else if (options.shell === "drop") response.destroy();
      else send({ accepted: true });
    } else if (url.pathname.endsWith("/prompt")) send({ accepted: true });
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
  const emit = (event: Record<string, unknown>) => {
    if (event["type"] === "status.update") state.status = event["status"] as SessionStatus;
    for (const socket of ws.clients) socket.send(JSON.stringify({ ...event, seq: ++state.seq }));
  };
  void store.start();
  await until(() => store.getSnapshot().connection.type === "ready");
  const drop = () => { for (const socket of ws.clients) socket.terminate(); };
  return { store, requests, emit, state, drop };
}
const posted = (requests: { path: string }[]) => requests.filter((request) => /\/(shell|prompt|commands\/run)$/u.test(request.path)).map((request) => request.path.split("/").at(-1));
const image: PromptAttachment = { kind: "image", name: "a.png", mimeType: "image/png", data: "aGk=" };

describe("shell commands from the one composer", () => {
  it("sends a ! draft to the shell endpoint with the text the server parses, never as a prompt", async () => {
    const { store, requests } = await shellServer();
    await store.send("  !!ls -la");
    expect(requests.find((request) => request.path.endsWith("/shell"))?.body).toEqual({ cwd: "/work tree", text: "!!ls -la" });
    expect(posted(requests)).toEqual(["shell"]);
    expect(store.getSnapshot().sending).toBe(false);
  });
  it("rejects attachments and missing commands before any request", async () => {
    const { store, requests } = await shellServer();
    await expect(store.send("!ls", [image])).rejects.toThrow("Remove attachments before running a shell command.");
    await expect(store.send("!! ")).rejects.toThrow("Type a command after !.");
    expect(posted(requests)).toEqual([]);
  });
  it("runs a command during an agent run, which the server allows", async () => {
    const { store, requests } = await shellServer({ status: { ...idle, isStreaming: true } });
    expect(shellAvailabilityOf(store.getSnapshot())).toEqual({ type: "ready" });
    await store.send("!date");
    expect(posted(requests)).toEqual(["shell"]);
  });
  it("blocks a second command while the first one runs, even before any status update", async () => {
    const { store, requests, emit } = await shellServer();
    emit({ type: "shell.start", command: "sleep 9", excludeFromContext: false });
    await until(() => isBashRunning(store.getSnapshot()));
    expect(shellAvailabilityOf(store.getSnapshot())).toEqual({ type: "blocked", reason: "Wait for the running shell command to finish." });
    await expect(store.send("!pwd")).rejects.toThrow("Wait for the running shell command to finish.");
    // Ask mode sends through the store, so the reason must be visible there too.
    expect(store.getSnapshot().commandError).toBe("Wait for the running shell command to finish.");
    expect(posted(requests)).toEqual([]);
    emit({ type: "shell.end", output: "", exitCode: 0, cancelled: false, truncated: false });
    await until(() => !isBashRunning(store.getSnapshot()));
    expect(shellAvailabilityOf(store.getSnapshot()).type).toBe("ready");
  });
  it("shows the server's rejection and does not retry it", async () => {
    const { store, requests } = await shellServer({ shell: "reject" });
    await expect(store.send("!ls")).rejects.toThrow("A bash command is already running");
    expect(store.getSnapshot().commandError).toBe("A bash command is already running");
    expect(posted(requests)).toEqual(["shell"]);
  });
  it("warns that a command with a lost acknowledgement may have started, without retrying", async () => {
    const { store, requests } = await shellServer({ shell: "drop" });
    await expect(store.send("!make deploy")).rejects.toThrow();
    expect(store.getSnapshot().commandError).toMatch(/may have started\. Check the conversation before running it again\.$/u);
    expect(posted(requests)).toEqual(["shell"]);
  });
});

describe("shell rows across a reconnect", () => {
  it("keeps a finished row whose record Pi has not saved yet, with the same identity", async () => {
    const { store, emit, drop, requests } = await shellServer({ status: { ...idle, isStreaming: true } });
    emit({ type: "shell.start", command: "date", excludeFromContext: false });
    emit({ type: "shell.end", output: "now\n", exitCode: 0, cancelled: false, truncated: false });
    const shellRow = () => store.getSnapshot().transcript.messages.find((message) => message.role === "shell");
    await until(() => JSON.stringify(shellRow()?.parts).includes("now"));
    const id = shellRow()!.id;
    drop();
    const historyReads = () => requests.filter((request) => request.path.endsWith("/messages")).length;
    await until(() => historyReads() === 2 && store.getSnapshot().connection.type === "ready");
    expect(store.getSnapshot().transcript.messages.filter((message) => message.role === "shell").map((message) => message.id)).toEqual([id]);
  });
});

describe("a running shell command is not an agent run", () => {
  it("keeps Send available and accepts prompts while only a shell command runs", async () => {
    const { store, requests, emit } = await shellServer();
    emit({ type: "status.update", status: { ...idle, isBashRunning: true } });
    await until(() => isBashRunning(store.getSnapshot()));
    expect(store.getSnapshot().transcript.isRunning).toBe(false);
    await store.send("hello");
    expect(posted(requests)).toEqual(["prompt"]);
  });
  it("shows a command that already runs when the client joins, and its later output", async () => {
    const { store, emit } = await shellServer({ status: { ...idle, isBashRunning: true },
      history: [{ role: "bashExecution", command: "ls", output: "a\n", exitCode: 0, timestamp: 4 }] });
    const shellRows = () => store.getSnapshot().transcript.messages.filter((message) => message.role === "shell");
    expect(shellRows()).toHaveLength(2);
    expect(store.getSnapshot().transcript.isRunning).toBe(false);
    emit({ type: "shell.chunk", chunk: "tick\n" });
    await until(() => JSON.stringify(shellRows()[1]?.parts).includes("tick"));
    expect(shellRows()).toHaveLength(2);
  });
});
