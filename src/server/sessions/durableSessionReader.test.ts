import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { WebSocket } from "ws";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { Harness, LiveDoc, UserEntry, createRegistry, type EntryRecord } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { durableBrowserSnapshotSchema, type DurableBrowserSnapshot } from "../../shared/durableBrowserSnapshot.js";
import { SessionEventHub, type RealtimeSocket } from "../realtime/sessionEventHub.js";
import { DurableParentReadModel } from "./durableParentReadModel.js";
import { DurableSessionReader } from "./durableSessionReader.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";
import { PiSessionService } from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { testModelRuntime } from "./piSessionService.testSupport.js";
import { registerSessionRoutes } from "./sessionRoutes.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-native-routes-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "state.sqlite");
  const models = createModels();
  const provider = fauxProvider();
  models.setProvider(provider.provider);
  let harness = await Harness.open(await openNodeSqliteStorage(databasePath), { models, registry: createRegistry() }, context);
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
  const hub = new SessionEventHub();
  let app: FastifyInstance | undefined;
  let service: PiSessionService | undefined;
  async function start() {
    app = Fastify({ logger: false });
    await app.register(websocket);
    service = new PiSessionService(hub, { agentDir: directory, sessionManager: gateway, modelRuntime: testModelRuntime, durableReader: reader, heartbeatIntervalMs: 60_000 });
    registerSessionRoutes(app, service, hub);
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
  return { directory, reader, user, provider, start, restart, hub, conversation: () => conversation, scheduling: async () => (await harness.inspect(context)).scheduling,
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

describe("native read-model HTTP and WebSocket paths", () => {
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
