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
import { initializeParentDocuments } from "./durableParentDocuments.js";
import { DurableParentReadModel } from "./durableParentReadModel.js";
import { DurableSessionReader } from "./durableSessionReader.js";
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
