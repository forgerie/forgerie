import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { WebSocket } from "ws";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxToolCall, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { Harness, GenerationTask, InboxDoc, LiveDoc, UsageDoc, UserEntry, createRegistry, defineExtension, defineTool, type EntryRecord } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { durableBrowserSnapshotSchema, type DurableBrowserSnapshot } from "../../shared/durableBrowserSnapshot.js";
import { SessionEventHub, type RealtimeSocket } from "../realtime/sessionEventHub.js";
import { initializeParentDocuments, Presentation } from "./durableParentDocuments.js";
import { DurableParentReadModel, type DurableHostState } from "./durableParentReadModel.js";
import { DurableSessionReader } from "./durableSessionReader.js";
import type { SessionOpenResult } from "./sessionOpen.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";
import { PiSessionService } from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { testModelRuntime } from "./piSessionService.testSupport.js";
import { registerDurableTaskRoutes } from "./durableTaskRoutes.js";
import { registerSessionRoutes } from "./sessionRoutes.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function fixture(hub = new SessionEventHub()) {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-native-routes-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "state.sqlite");
  const models = createModels();
  const provider = fauxProvider();
  models.setProvider(provider.provider);
  const registry = createRegistry();
  let harness = await Harness.open(await openNodeSqliteStorage(databasePath), { models, registry }, context);
  let conversation = await harness.root(context);
  let leased = 0;
  let acquired = 0;
  let acquireError: Error | undefined;
  let legacy = false;
  const messageId = (entry: EntryRecord, index: number) => `entry:${String(entry.conversationId)}:${String(entry.id)}:${String(index)}`;
  const readerOptions: ConstructorParameters<typeof DurableSessionReader>[0] = {
    locate: () => Promise.resolve(legacy ? undefined : { journalId: "family", databasePath, sessionId: "logical", conversationId: conversation.id }),
    acquire(address) {
      if (acquireError !== undefined) return Promise.reject(acquireError);
      acquired++; leased++;
      let released = false;
      const handle: DurableSessionHandle = { address, harness, conversation, release() { if (!released) { released = true; leased--; } return Promise.resolve(); } };
      return Promise.resolve(handle);
    },
    readModel: (handle) => new DurableParentReadModel({ handle, messageId }),
    history() { throw new Error("Tree factory must be supplied by native-fork #45"); },
  };
  let reader = new DurableSessionReader(readerOptions);
  const user = (text: string) => conversation.commit((tx) => tx.appendEntry(UserEntry, conversation.id, { model: [{ role: "user", content: text, timestamp: 1 }] }), context);
  const gateway = createPiSessionManagerGateway({ agentDir: directory, env: {}, sessionDirEnvKeys: [] });
  let app: FastifyInstance | undefined;
  let service: PiSessionService | undefined;
  async function start() {
    app = Fastify({ logger: false });
    await app.register(websocket);
    service = new PiSessionService(hub, { agentDir: directory, sessionManager: gateway, modelRuntime: testModelRuntime, durableReader: reader, heartbeatIntervalMs: 60_000 });
    registerSessionRoutes(app, service, hub);
    registerDurableTaskRoutes(app, service);
    return app.listen({ host: "127.0.0.1", port: 0 });
  }
  async function stop() { await app?.close(); await service?.dispose(); app = undefined; service = undefined; }
  cleanups.push(async () => { await stop(); await harness.close(context); });
  const restart = async () => {
    await stop(); await harness.close(context);
    harness = await Harness.open(await openNodeSqliteStorage(databasePath), { models, registry: createRegistry() }, context);
    const recovered = await harness.conversation(conversation.id, context);
    if (recovered === undefined) throw new Error("Persisted conversation missing");
    conversation = recovered;
    reader = new DurableSessionReader(readerOptions);
    return start();
  };
  return { directory, reader, user, provider, start, restart, hub, registry, harness: () => harness, conversation: () => conversation, scheduling: async () => (await harness.inspect(context)).scheduling,
    leased: () => leased, acquired: () => acquired, failAcquire: (error: Error) => { acquireError = error; }, useLegacy: () => { legacy = true; } };
}

function client(base: string, cwd: string) {
  const socket = new WebSocket(`${base.replace("http:", "ws:")}/sessions/logical/events?${new URLSearchParams({ cwd, native: "1" })}`);
  const frames: DurableBrowserSnapshot[] = [];
  socket.on("message", (payload) => { frames.push(durableBrowserSnapshotSchema.parse(JSON.parse(Buffer.isBuffer(payload) ? payload.toString("utf8") : new TextDecoder().decode(payload instanceof ArrayBuffer ? payload : Buffer.concat(payload))))); });
  cleanups.push(async () => { if (socket.readyState === socket.CLOSED) return; await new Promise<void>((resolve) => { socket.once("close", () => { resolve(); }); socket.close(); }); });
  return { socket, frames };
}

function emptySnapshot(): DurableBrowserSnapshot {
  return { type: "session.snapshot", epoch: "transport", revision: 0, history: { messages: [], start: 0, total: 0 }, partial: null, tools: [], queuedMessages: [], isStreaming: false, isCompacting: false };
}

/** Actual socket transport with configured completion and buffering behavior. */
class ControlledWebSocketTransport implements RealtimeSocket {
  readonly OPEN = WebSocket.OPEN;
  constructor(private readonly socket: WebSocket, private readonly behavior: { complete: boolean; bufferedBytes: number }) {}
  get readyState() { return this.socket.readyState; }
  get bufferedAmount() { return this.behavior.bufferedBytes + this.socket.bufferedAmount; }
  send(payload: string, callback?: (error?: Error | null) => void): void { this.socket.send(payload, (error) => { if (this.behavior.complete) callback?.(error); }); }
  terminate(): void { this.socket.terminate(); }
  on(event: "close", listener: () => void) { return this.socket.on(event, listener); }
}

/** Hold one real send's completion so the watch, not a host queue, owns pending commits. */
class CompletionGateSessionEventHub extends SessionEventHub {
  constructor(private readonly failReplacement = false) { super(); }
  private releaseSend!: () => void;
  private readonly gate = new Promise<void>((resolve) => { this.releaseSend = resolve; });
  private held = false;
  release(): void { this.releaseSend(); }
  override async sendDurableSnapshot(socket: RealtimeSocket, snapshot: DurableBrowserSnapshot): Promise<void> {
    if (this.failReplacement && snapshot.revision > 0) throw new Error("replacement transport failed");
    await super.sendDurableSnapshot(socket, snapshot);
    if (!this.held) { this.held = true; await this.gate; }
  }
}

describe("native read-model HTTP and WebSocket paths", () => {
  it("serves live task activity through the real HTTP reader lease without opening or resuming a runtime", async () => {
    const f = await fixture();
    const task = await f.conversation().commit(tx => tx.createTask(GenerationTask, {}, { ownership: { kind: "conversation" } }), context);
    const base = await f.start();
    const response = await fetch(`${base}/sessions/logical/tasks?${new URLSearchParams({ cwd: f.directory })}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: "ready", parentConversationId: f.conversation().id, backgroundAgents: 0, agents: [], tasks: [{ id: task, label: "Answering your message", status: "pending", scheduler: "ready", startedAt: null, restart: "resumes" }] });
    expect(f.acquired()).toBe(1);
    expect(f.leased()).toBe(0);
    expect(await f.scheduling()).toBe("paused");
    f.useLegacy();
    expect(await f.reader.tasks({ id: "legacy", cwd: f.directory })).toEqual({ kind: "unsupported" });
    expect(f.acquired()).toBe(1);
  });

  it("releases the read lease when task projection fails", async () => {
    const f = await fixture();
    const inspect = vi.spyOn(f.harness(), "inspect").mockRejectedValue(new Error("inspection failed"));
    await expect(f.reader.tasks({ id: "logical", cwd: f.directory })).rejects.toThrow("inspection failed");
    expect(f.leased()).toBe(0);
    inspect.mockRestore();
    expect(await f.scheduling()).toBe("paused");
  });

  it("serves history without a compatibility file and late-joins a real socket during tool output", async () => {
    const f = await fixture();
    await f.user("native input");
    await f.conversation().commit(async (tx) => { (await tx.doc(LiveDoc, f.conversation().id)).tools = [{ callId: "tool", name: "read", status: "running", output: "already committed" }]; }, context);
    const base = await f.start();
    const response = await fetch(`${base}/sessions/logical/messages?${new URLSearchParams({ cwd: f.directory, limit: "1" })}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ messages: [{ content: "native input" }], total: 1 });
    const { frames, socket } = client(base, f.directory);
    await vi.waitFor(() => { expect(frames[0]?.tools).toEqual([{ toolCallId: "tool", toolName: "read", status: "running", output: "already committed" }]); });
    expect(f.leased()).toBe(1);
    expect(await f.scheduling()).toBe("paused");
    expect(f.provider.state.callCount).toBe(0);
    socket.close();
    await vi.waitFor(() => { expect(f.leased()).toBe(0); });
  });

  it("reattaches with a new epoch after a server and SQLite reopen, preserving committed message IDs", async () => {
    const f = await fixture();
    await f.user("before restart");
    const first = client(await f.start(), f.directory);
    await vi.waitFor(() => { expect(first.frames).toHaveLength(1); });
    const old = first.frames[0];
    first.socket.close();
    await vi.waitFor(() => { expect(f.leased()).toBe(0); });
    const base = await f.restart();
    await f.user("after restart");
    const second = client(base, f.directory);
    await vi.waitFor(() => { expect(second.frames[0]?.history.total).toBe(2); });
    expect(second.frames[0]?.epoch).not.toBe(old?.epoch);
    expect(second.frames[0]?.revision).toBe(0);
    expect(second.frames[0]?.history.messages[0]?.id).toBe(old?.history.messages[0]?.id);
    expect(await f.scheduling()).toBe("paused");
    expect(f.provider.state.callCount).toBe(0);
  });

  it("sends one replacement to a real client blocked more than 100 commits, with no duplicate append", async () => {
    const hub = new CompletionGateSessionEventHub();
    const f = await fixture(hub);
    const base = await f.start();
    const connection = client(base, f.directory);
    await vi.waitFor(() => { expect(connection.frames).toHaveLength(1); });
    try {
      for (let index = 0; index < 103; index++) await f.user(`commit ${String(index)}`);
      expect(connection.frames).toHaveLength(1);
    } finally { hub.release(); }
    await vi.waitFor(() => { expect(connection.frames).toHaveLength(2); });
    const replacement = connection.frames[1];
    expect(replacement?.type).toBe("session.snapshot");
    expect(replacement?.history.total).toBe(103);
    expect(replacement?.history.start).toBe(3);
    expect(replacement?.history.messages).toHaveLength(100);
    expect(new Set(replacement?.history.messages.map((message) => message.id)).size).toBe(100);
    const response = await fetch(`${base}/sessions/logical/messages?${new URLSearchParams({ cwd: f.directory, limit: "500" })}`);
    expect(response.status).toBe(200);
    const history = durableBrowserSnapshotSchema.shape.history.parse(await response.json());
    expect(history.messages).toHaveLength(103);
    expect(history.messages.slice(3)).toEqual(replacement?.history.messages);
    expect(replacement?.revision).toBe(1);
    expect(replacement?.epoch).toBe(connection.frames[0]?.epoch);
    expect(replacement?.history.messages.at(-1)?.content).toBe("commit 102");
  });

  it("closes the client and releases its lease when an overflow replacement cannot be sent", async () => {
    const hub = new CompletionGateSessionEventHub(true);
    const f = await fixture(hub);
    const connection = client(await f.start(), f.directory);
    await vi.waitFor(() => { expect(connection.frames).toHaveLength(1); });
    try { for (let index = 0; index < 103; index++) await f.user(`commit ${String(index)}`); }
    finally { hub.release(); }
    await vi.waitFor(() => { expect(connection.socket.readyState).toBe(WebSocket.CLOSED); expect(f.leased()).toBe(0); });
  });

  it("late-joins during a real native tool invocation and replaces live output with its committed result", async () => {
    const f = await fixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    f.registry.install(defineExtension({ name: "held-output", tools: [defineTool({ name: "held_output", description: "Produce held output", parameters: Type.Object({}), replay: "unsafe",
      execute: async (_args, api) => { api.output("running output"); await held; return { content: [{ type: "text", text: "finished output" }] }; } })] }));
    const model = f.provider.getModel();
    await f.conversation().configure({ model: { provider: model.provider, modelId: model.id } }, context);
    f.provider.setResponses([fauxAssistantMessage([fauxToolCall("held_output", {})], { stopReason: "toolUse" }), fauxAssistantMessage("complete")]);
    f.harness().resume();
    const submission = await f.conversation().submit({ type: "input", content: "run the output tool" }, context);
    try {
      await vi.waitFor(async () => { expect((await f.harness().snapshot(LiveDoc, f.conversation().id, context))?.tools?.[0]?.output).toBe("running output"); });
      const base = await f.start();
      const connection = client(base, f.directory);
      await vi.waitFor(() => { expect(connection.frames[0]?.tools[0]?.output).toBe("running output"); });
      expect(connection.frames[0]?.isStreaming).toBe(true);
      release();
      await submission.wait(context);
      await f.conversation().waitForIdle(context);
      await vi.waitFor(() => { expect(connection.frames.at(-1)?.isStreaming).toBe(false); });
      const final = connection.frames.at(-1);
      expect(final?.tools).toEqual([]);
      expect(final?.history.messages.filter((message) => message.role === "toolResult")).toHaveLength(1);
      expect(final?.history.messages.find((message) => message.role === "toolResult")?.content).toEqual([{ type: "text", text: "finished output" }]);
      expect(f.provider.state.callCount).toBe(2);
    } finally { release(); await f.conversation().waitForIdle(context); }
  });

  it("never falls back to JSONL when a native locator's journal fails", async () => {
    const f = await fixture();
    f.failAcquire(new Error("native journal is damaged"));
    const base = await f.start();
    const response = await fetch(`${base}/sessions/logical/messages?${new URLSearchParams({ cwd: f.directory })}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "native journal is damaged" });
    expect(f.acquired()).toBe(0);
  });

  it("uses the legacy read-only path only when there is no native locator", async () => {
    const f = await fixture();
    f.useLegacy();
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    const gateway = createPiSessionManagerGateway({ agentDir: f.directory, env: {}, sessionDirEnvKeys: [] });
    const manager = gateway.create(f.directory);
    const file = manager.getSessionFile();
    if (file === undefined) throw new Error("Fixture requires a legacy path");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, [
      { type: "session", version: 3, id, cwd: f.directory, timestamp: new Date(0).toISOString() },
      { type: "message", id: "legacy-message", parentId: null, timestamp: new Date(0).toISOString(), message: { role: "user", content: "legacy input", timestamp: 1 } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    expect(SessionManager.open(file).getSessionId()).toBe(id);
    const base = await f.start();
    const response = await fetch(`${base}/sessions/${id}/messages?${new URLSearchParams({ cwd: f.directory })}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ messages: [{ content: "legacy input" }] });
    expect(f.acquired()).toBe(0);
    const tasks = await fetch(`${base}/sessions/${id}/tasks?${new URLSearchParams({ cwd: f.directory })}`);
    expect(tasks.status).toBe(200);
    expect(await tasks.json()).toEqual({ kind: "unsupported" });
    expect((await fetch(`${base}/sessions/unknown/tasks?${new URLSearchParams({ cwd: f.directory })}`)).status).toBe(404);
    expect(f.acquired()).toBe(0);
    const opened = await fetch(`${base}/sessions/${id}/open?${new URLSearchParams({ cwd: f.directory })}`);
    expect(opened.status).toBe(200);
    expect(await opened.json()).toMatchObject({ readPath: "classic", cut: "classic", page: { messages: [{ content: "legacy input" }] } });
    const socket = new WebSocket(`${base.replace("http:", "ws:")}/sessions/${id}/events?${new URLSearchParams({ cwd: f.directory, native: "1", open: "1" })}`);
    const frames: unknown[] = [];
    socket.on("message", payload => { frames.push(JSON.parse(Buffer.isBuffer(payload) ? payload.toString("utf8") : new TextDecoder().decode(payload instanceof ArrayBuffer ? payload : Buffer.concat(payload)))); });
    try {
      await vi.waitFor(() => { expect(frames[0]).toMatchObject({ type: "session.checkpoint", readPath: "classic" }); });
      f.hub.publish(id, { type: "assistant.delta", text: "classic authority" });
      await vi.waitFor(() => { expect(frames[1]).toMatchObject({ type: "assistant.delta", text: "classic authority" }); });
      expect(f.acquired()).toBe(0);
    } finally { await new Promise<void>(resolve => { socket.once("close", () => { resolve(); }); socket.close(); }); }
  });

  it.each(["stalled", "buffered"] as const)("closes a %s real socket instead of hiding an unbounded transport queue", async (kind) => {
    const f = await fixture();
    const app = Fastify({ logger: false });
    await app.register(websocket);
    let sent!: Promise<void>;
    app.get("/transport", { websocket: true }, (socket) => {
      const transport = new ControlledWebSocketTransport(socket, { complete: kind !== "stalled", bufferedBytes: kind === "buffered" ? 1024 : 0 });
      sent = f.hub.sendDurableSnapshot(transport, emptySnapshot(), { maxBytes: 512, timeoutMs: 20 });
      // Attach a rejection handler before the client event loop observes it.
      void sent.catch(() => undefined);
    });
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${base.replace("http:", "ws:")}/transport`);
    try {
      await new Promise<void>((resolve) => { socket.once("close", () => { resolve(); }); });
      await expect(sent).rejects.toThrow(kind === "stalled" ? "stalled" : "byte limit");
    } finally { socket.terminate(); await app.close(); }
  });
});

it("serves a configured native open as one read-only cut and releases its lease on failure", async () => {
  const f = await fixture();
  await f.conversation().commit(async tx => {
    await initializeParentDocuments(tx, { id: f.conversation().id });
    await tx.doc(LiveDoc, f.conversation().id); await tx.doc(InboxDoc, f.conversation().id); await tx.doc(UsageDoc, f.conversation().id);
  }, context);
  await f.user("native open without any JSONL");
  const base = await f.start();
  const path = `${base}/sessions/logical/open?${new URLSearchParams({ cwd: f.directory, limit: "50" })}`;
  const response = await fetch(path);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ readPath: "native", epoch: f.hub.epoch, session: { id: "logical" }, page: { start: 0, total: 1, messages: [{ content: "native open without any JSONL" }] } });
  expect(f.leased()).toBe(0);
  expect(await f.scheduling()).toBe("paused");
  f.failAcquire(new Error("native read unavailable"));
  const failed = await fetch(path);
  expect(failed.status).toBe(503);
  expect(await failed.json()).toMatchObject({ error: "native read unavailable" });
  expect(f.leased()).toBe(0);
});


it("publishes one seed and shuts down even when every native acquisition makes the session dirty again", async () => {
  const f = await fixture();
  await f.conversation().commit(tx => initializeParentDocuments(tx, { id: f.conversation().id }), context);
  let keepDirty = true, releases = 0;
  let seed!: () => void;
  const seeded = new Promise<void>(resolve => { seed = resolve; });
  const reader = new DurableSessionReader({
    locate: () => Promise.resolve({ journalId: "family", databasePath: join(f.directory, "state.sqlite"), sessionId: "logical", conversationId: f.conversation().id }),
    acquire: address => Promise.resolve({ address, harness: f.harness(), conversation: f.conversation(), release: () => { releases++; return Promise.resolve(); } }),
    readModel: handle => {
      const model = new DurableParentReadModel({ handle, messageId: entry => String(entry.id) });
      const open = model.open.bind(model);
      model.open = async (...args) => {
        const cut = await open(...args);
        if (keepDirty) await f.user("commit during native acquisition");
        await new Promise<void>(resolve => { setImmediate(resolve); });
        return cut;
      };
      return model;
    },
    history: () => { throw new Error("Not read"); },
  });
  const opening = reader.attachOpen({ id: "logical", cwd: f.directory }, f.hub, () => { seed(); return Promise.resolve(); }, error => { throw error; });
  let closing: Promise<void> | undefined;
  try {
    await seeded;
    closing = reader.close();
    expect(await Promise.race([closing.then(() => "closed"), new Promise<string>(resolve => { setTimeout(() => { resolve("timed out"); }, 200); })])).toBe("closed");
    expect(await opening).toBeDefined();
    expect(releases).toBe(1);
  } finally { keepDirty = false; await closing; await opening; await reader.close(); }
});


it("shares native tail acquisition across attachments and ignores SDK-only status and unrelated family commits", async () => {
  const f = await fixture();
  await f.conversation().commit(tx => initializeParentDocuments(tx, { id: f.conversation().id }), context);
  const sibling = await f.harness().createConversation({ ownership: { kind: "ownerless" } }, context);
  let acquisitions = 0, leases = 0;
  const scans = vi.spyOn(f.conversation(), "entries");
  const reader = new DurableSessionReader({
    locate: () => Promise.resolve({ journalId: "family", databasePath: join(f.directory, "state.sqlite"), sessionId: "logical", conversationId: f.conversation().id }),
    acquire: address => { leases++; return Promise.resolve({ address, harness: f.harness(), conversation: f.conversation(), release: () => { leases--; return Promise.resolve(); } }); },
    readModel: handle => {
      const model = new DurableParentReadModel({ handle, messageId: entry => String(entry.id) });
      const open = model.open.bind(model);
      model.open = (...args) => { acquisitions++; return open(...args); };
      return model;
    }, history: () => { throw new Error("Not read"); },
  });
  const frames: SessionOpenResult[][] = [[], [], []];
  let host: DurableHostState = {};
  try {
    await Promise.all(frames.map(output => reader.attachOpen({ id: "logical", cwd: f.directory }, f.hub, cut => { output.push(cut); return Promise.resolve(); }, error => { throw error; }, () => host)));
    expect(acquisitions).toBe(1); expect(leases).toBe(1);
    const initialScans = scans.mock.calls.length;
    await f.user("new committed input");
    await vi.waitFor(() => { expect(frames.map(output => output.at(-1)?.page.total)).toEqual([1, 1, 1]); });
    expect(acquisitions).toBe(2);
    expect(frames[0]?.at(-1)).toBe(frames[2]?.at(-1));
    expect(Object.isFrozen(frames[0]?.at(-1)?.page.messages[0])).toBe(true);
    expect(scans).toHaveBeenCalledTimes(initialScans);
    const baseline = acquisitions;
    for (let index = 0; index < 3; index++) f.hub.publish("logical", { type: "status.update", status: { sessionId: "logical", isStreaming: index % 2 === 0, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 } });
    await sibling.commit(tx => tx.appendEntry(UserEntry, sibling.id, { model: [{ role: "user", content: "unrelated", timestamp: 1 }] }), context);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    expect(acquisitions).toBe(baseline);
    host = { compaction: { isRunning: true, queuedMessages: [{ kind: "followUp", text: "host-owned queued prompt" }] } };
    for (let index = 0; index < 3; index++) f.hub.publish("logical", { type: "status.update", status: { sessionId: "logical", isStreaming: false, isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 } });
    await vi.waitFor(() => { expect(frames.every(output => output.at(-1)?.status.isCompacting === true)).toBe(true); });
    expect(acquisitions).toBe(baseline + 1);
    expect(frames.map(output => output.at(-1)?.status.queuedMessages)).toEqual(Array.from({ length: 3 }, () => [{ kind: "followUp", text: "host-owned queued prompt" }]));
    await f.conversation().commit(async tx => { (await tx.doc(LiveDoc, f.conversation().id)).generation = { attempt: 1, message: { role: "assistant", api: "faux", provider: "faux", model: "faux-1", stopReason: "stop", timestamp: 1,
      usage: fauxAssistantMessage("").usage, content: [{ type: "text", text: "bounded partial" }] } }; }, context);
    await vi.waitFor(() => { expect(frames.every(output => output.at(-1)?.snapshot.partial?.content === undefined ? false : JSON.stringify(output.at(-1)?.snapshot.partial?.content).includes("bounded partial"))).toBe(true); });
    expect(acquisitions).toBe(baseline + 2);
    expect(scans).toHaveBeenCalledTimes(initialScans);
    await f.conversation().commit(async tx => {
      const entry = await tx.appendEntry(UserEntry, f.conversation().id, { model: [{ role: "user", content: "committed custom content", timestamp: 2 }] });
      (await tx.doc(Presentation, f.conversation().id, String(entry.id), null)).envelope = { type: "custom", customType: "native-notice", display: true };
    }, context);
    await vi.waitFor(() => { expect(frames.every(output => output.at(-1)?.page.messages.at(-1)?.role === "custom")).toBe(true); });
    expect(scans).toHaveBeenCalledTimes(initialScans);
    const full = await reader.open({ id: "logical", cwd: f.directory }, { limit: 50 }, f.hub, () => host);
    expect(frames.every(output => JSON.stringify(output.at(-1)?.page) === JSON.stringify(full?.page))).toBe(true);
  } finally { await reader.close(); }
  expect(leases).toBe(0);
});


it("releases a native lease admitted while shutdown waits for acquisition", async () => {
  const f = await fixture();
  let admitted!: () => void, release!: () => void;
  const acquiring = new Promise<void>(resolve => { admitted = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let releases = 0;
  const sends = vi.fn(() => Promise.resolve());
  const reader = new DurableSessionReader({
    locate: () => Promise.resolve({ journalId: "family", databasePath: join(f.directory, "state.sqlite"), sessionId: "logical", conversationId: f.conversation().id }),
    acquire: async address => { admitted(); await gate; return { address, harness: f.harness(), conversation: f.conversation(), release: () => { releases++; return Promise.resolve(); } }; },
    readModel: () => { throw new Error("A shutdown admission must not read"); }, history: () => { throw new Error("Not read"); },
  });
  const opening = reader.attachOpen({ id: "logical", cwd: f.directory }, f.hub, sends, () => { /* No source has attached. */ });
  const rejected = expect(opening).rejects.toThrow("reader is closed");
  await acquiring;
  const closing = reader.close(); release();
  await closing; await rejected;
  expect(sends).not.toHaveBeenCalled(); expect(releases).toBe(1);
});


it("keeps healthy native attachments current while another transport stalls and fails", async () => {
  const f = await fixture();
  await f.conversation().commit(tx => initializeParentDocuments(tx, { id: f.conversation().id }), context);
  let leases = 0, acquisitions = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reader = new DurableSessionReader({
    locate: () => Promise.resolve({ journalId: "family", databasePath: join(f.directory, "state.sqlite"), sessionId: "logical", conversationId: f.conversation().id }),
    acquire: address => { leases++; return Promise.resolve({ address, harness: f.harness(), conversation: f.conversation(), release: () => { leases--; return Promise.resolve(); } }); },
    readModel: handle => {
      const model = new DurableParentReadModel({ handle, messageId: entry => String(entry.id) });
      const open = model.open.bind(model);
      model.open = (...args) => { acquisitions++; return open(...args); }; return model;
    }, history: () => { throw new Error("Not read"); },
  });
  const healthy: SessionOpenResult[] = [];
  const errors: string[] = [];
  try {
    const slow = await reader.attachOpen({ id: "logical", cwd: f.directory }, f.hub, async cut => {
      if (cut.page.total === 0) return;
      await gate; throw new Error("Configured stalled transport failure");
    }, error => { errors.push(error.message); });
    await reader.attachOpen({ id: "logical", cwd: f.directory }, f.hub, cut => { healthy.push(cut); return Promise.resolve(); }, error => { errors.push(error.message); });
    await f.user("first progress");
    await vi.waitFor(() => { expect(healthy.at(-1)?.page.total).toBe(1); });
    await f.user("latest progress");
    await vi.waitFor(() => { expect(healthy.at(-1)?.page.total).toBe(2); });
    expect(acquisitions).toBe(3); expect(leases).toBe(1);
    release();
    expect(await slow?.closed).toMatchObject({ reason: "listener_error" });
    expect(errors).toEqual(["Configured stalled transport failure"]);
    await f.user("after failure");
    await vi.waitFor(() => { expect(healthy.at(-1)?.page.total).toBe(3); });
    expect(leases).toBe(1);
  } finally { release(); await reader.close(); }
  expect(leases).toBe(0);
});


it("releases admission without observers if obtaining initial host state fails", async () => {
  const f = await fixture();
  let observations = 0, leases = 0;
  const subscribe = f.harness().subscribeCommits.bind(f.harness());
  const observed = vi.spyOn(f.harness(), "subscribeCommits").mockImplementation(listener => {
    observations++; const stop = subscribe(listener);
    return () => { observations--; stop(); };
  });
  const reader = new DurableSessionReader({
    locate: () => Promise.resolve({ journalId: "family", databasePath: join(f.directory, "state.sqlite"), sessionId: "logical", conversationId: f.conversation().id }),
    acquire: address => { leases++; return Promise.resolve({ address, harness: f.harness(), conversation: f.conversation(), release: () => { leases--; return Promise.resolve(); } }); },
    readModel: handle => new DurableParentReadModel({ handle, messageId: entry => String(entry.id) }), history: () => { throw new Error("Not read"); },
  });
  try {
    await expect(reader.attachOpen({ id: "logical", cwd: f.directory }, f.hub, () => Promise.resolve(), () => { /* Admission fails before observation. */ }, () => { throw new Error("Host state unavailable"); })).rejects.toThrow("Host state unavailable");
    expect(leases).toBe(0); expect(observations).toBe(0);
  } finally { observed.mockRestore(); await reader.close(); }
});


it.each(["hide", "same-count"] as const)("invalidates HTTP cursors and publisher generations for a %s presentation correction, including reconnect", async kind => {
  const f = await fixture();
  const entries: EntryRecord[] = [];
  await f.conversation().commit(async tx => {
    await initializeParentDocuments(tx, { id: f.conversation().id });
    for (let index = 0; index < 200; index++) entries.push(await tx.appendEntry(UserEntry, f.conversation().id, { model: [{ role: "user", content: `m${String(index)}`, timestamp: index }] }));
  }, context);
  const ref = { id: "logical", cwd: f.directory };
  const first = await f.reader.open(ref, { limit: 50 }, f.hub);
  if (first === undefined) throw new Error("Missing native seed");
  const base = await f.start();
  const older = await fetch(`${base}/sessions/logical/messages?${new URLSearchParams({ cwd: f.directory, before: "150", limit: "50", historyId: first.historyId })}`);
  expect(older.status).toBe(200);
  expect(await older.json()).toMatchObject({ start: 100, total: 200, historyId: first.historyId });
  const frames: SessionOpenResult[] = [];
  let attachment = await f.reader.attachOpen(ref, f.hub, cut => { frames.push(cut); return Promise.resolve(); }, error => { throw error; });
  try {
    expect(frames.at(-1)?.historyId).toBe(first.historyId);
    const target = entries[105]; if (target === undefined) throw new Error("Missing correction target");
    await f.conversation().commit(async tx => {
      (await tx.doc(Presentation, f.conversation().id, String(target.id), null)).envelope = { type: "custom", customType: "corrected", display: kind !== "hide" };
    }, context);
    await vi.waitFor(() => { expect(frames.at(-1)?.seq).toBeGreaterThan(first.seq); });
    const corrected = frames.at(-1); if (corrected === undefined) throw new Error("Missing corrected cut");
    expect(corrected.page.total).toBe(kind === "hide" ? 199 : 200);
    expect(corrected.historyId).not.toBe(first.historyId);
    const current = await fetch(`${base}/sessions/logical/open?${new URLSearchParams({ cwd: f.directory })}`);
    expect(await current.json()).toMatchObject({ historyId: corrected.historyId });
    const stale = await fetch(`${base}/sessions/logical/messages?${new URLSearchParams({ cwd: f.directory, before: "150", limit: "50", historyId: first.historyId })}`);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "HISTORY_CHANGED" });
    await attachment?.stop(); attachment = undefined;
    // No publisher exists during this correction. A reconnect and HTTP read must still agree.
    await f.conversation().commit(async tx => {
      (await tx.doc(Presentation, f.conversation().id, String(target.id), null)).envelope = { type: "custom", customType: "corrected-again", display: true };
    }, context);
    const rejoined = await f.reader.open(ref, { limit: 50 }, f.hub);
    expect(rejoined?.historyId).not.toBe(corrected.historyId);
    attachment = await f.reader.attachOpen(ref, f.hub, cut => { frames.push(cut); return Promise.resolve(); }, error => { throw error; });
    expect(frames.at(-1)?.historyId).toBe(rejoined?.historyId);
    const appended = await f.conversation().commit(async tx => {
      const entry = await tx.appendEntry(UserEntry, f.conversation().id, { model: [{ role: "user", content: "ordinary append", timestamp: 201 }] });
      (await tx.doc(Presentation, f.conversation().id, String(entry.id), null)).envelope = { type: "custom", customType: "new-append", display: true };
      return entry;
    }, context);
    await vi.waitFor(() => { expect(frames.at(-1)?.page.messages.at(-1)?.id).toBe(`entry:${String(appended.conversationId)}:${String(appended.id)}:0`); });
    expect(frames.at(-1)?.historyId).toBe(rejoined?.historyId);
  } finally { await attachment?.stop(); }
});
