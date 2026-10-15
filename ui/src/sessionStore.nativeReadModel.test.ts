import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { Harness, LiveDoc, createRegistry, defineExtension, defineTool } from "@earendil-works/pi-durable";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";
import { Type } from "typebox";
import { DurableRunBoundaries } from "../../src/server/sessions/durableRunBoundaries";
import { openFixture } from "./testing/openFixture";
import type { ServerResponse } from "node:http";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserTransport, createSessionStore, type SessionTransport, type SessionStore } from "./sessionStore";
import { sessionOpenSchema, type DurableBrowserSnapshot, type SessionOpen } from "./contracts";
import { messageText } from "./transcript";

const disposals: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

async function fixture(readPath: "native" | "classic" = "native") {
  const requests: string[] = [];
  let seed: SessionOpen | undefined;
  const waiting: ServerResponse[] = [];
  const transientEvents: SessionOpen["snapshot"]["transientEvents"] = [];
  let socket: ServerSocket | undefined;
  let connections = 0;
  const ws = new WebSocketServer({ noServer: true });
  const http = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    requests.push(path);
    if (path.endsWith("/open")) {
      if (seed === undefined) waiting.push(response);
      else { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(seed)); }
      return;
    }
    response.writeHead(path.endsWith("/commands") ? 200 : 503, { "Content-Type": "application/json" });
    response.end(JSON.stringify(path.endsWith("/commands") ? [] : { error: "Native joins must not read separate seeds" }));
  });
  http.on("upgrade", (request, stream, head) => {
    expect(new URL(request.url ?? "/", "http://localhost").searchParams.get("native")).toBe("1");
    ws.handleUpgrade(request, stream, head, (client) => { socket = client; connections++; seed = undefined; });
  });
  await new Promise<void>((resolve) => { http.listen(0, "127.0.0.1", resolve); });
  const address = http.address();
  if (address === null || typeof address === "string") throw new Error("No test port");
  const origin = `http://127.0.0.1:${address.port}`;
  const transport: SessionTransport = { nativeReadModel: true, request: (path, init) => fetch(origin + path, init),
    connect: (path) => new WebSocket(origin.replace("http:", "ws:") + path) };
  const piEvents: string[] = [];
  const store = createSessionStore("native", transport, { retryDelayMs: 5 }, { id: "native", cwd: "/temporary" }, undefined, event => piEvents.push(event));
  disposals.push(async () => {
    for (const client of ws.clients) client.terminate();
    ws.close(); http.closeAllConnections();
    await new Promise<void>((resolve) => { http.close(() => { resolve(); }); });
  });
  disposals.push(store.dispose);
  function publishOpen(open: SessionOpen) {
    seed = open;
    for (const response of waiting.splice(0)) { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(seed)); }
    socket?.send(JSON.stringify({ type: "session.open", open: seed }));
  }
  return { store, requests, piEvents, connections: () => connections, publishOpen,
    emit: (frame: unknown) => {
      if (typeof frame === "object" && frame !== null && "type" in frame && frame.type === "session.snapshot") {
        const value = frame as DurableBrowserSnapshot;
        seed = openFixture({ session: { id: "native", cwd: "/temporary" }, readPath, epoch: value.epoch,
          page: { ...value.history, total: Math.max(value.history.total, value.history.start + value.history.messages.length) },
          snapshot: { seq: value.revision * 10, partial: value.partial }, tools: value.tools, transientEvents,
          status: { isStreaming: value.isStreaming, isCompacting: value.isCompacting, isBashRunning: transientEvents.some(event => event.type === "shell.start"), queuedMessages: value.queuedMessages, pendingAsk: value.app?.pendingAsk } });
        publishOpen(seed);
      } else {
        if (typeof frame === "object" && frame !== null && "type" in frame && typeof frame.type === "string" && frame.type.startsWith("shell.")) transientEvents.push(frame as SessionOpen["snapshot"]["transientEvents"][number]);
        socket?.send(JSON.stringify(frame));
      }
    }, close: () => socket?.close() };
}

function waitFor(store: SessionStore, predicate: () => boolean) {
  if (predicate()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error("Native state did not settle")); }, 2000);
    const unsubscribe = store.subscribe(() => { if (predicate()) { clearTimeout(timeout); unsubscribe(); resolve(); } });
  });
}

function snapshot(revision = 0, epoch = "one"): DurableBrowserSnapshot {
  return { type: "session.snapshot", epoch, revision, history: { start: 0, total: 2, messages: [
    { id: "journal:entry:0", role: "user", content: "first contribution", timestamp: 1 },
    { id: "journal:entry:1", role: "user", content: "second contribution", timestamp: 1 },
  ] }, partial: null, tools: [], queuedMessages: [], isStreaming: false, isCompacting: false, app: { response: { kind: "none" } } };
}

async function join(f: Awaited<ReturnType<typeof fixture>>, frame = snapshot()) {
  const starting = f.store.start();
  // A store remains loading until its native socket publishes the complete seed.
  await new Promise<void>((resolve, reject) => {
    const tick = setInterval(() => { if (f.connections() === 1) { clearInterval(tick); clearTimeout(timeout); resolve(); } }, 5);
    const timeout = setTimeout(() => { clearInterval(tick); reject(new Error("No native socket")); }, 2000);
  });
  f.emit(frame);
  await starting;
  expect(f.store.getSnapshot().connection.type).toBe("ready");
}

describe("native browser replacement", () => {
  it("requests native admission in the production browser transport", () => {
    expect(browserTransport.nativeReadModel).toBe(true);
  });

  it("accepts classic SDK messages and status when native admission selects an inactive or non-Durable session", async () => {
    const f = await fixture("classic");
    await join(f);
    f.emit({ type: "assistant.delta", text: "classic live reply", seq: 1 });
    f.emit({ type: "status.update", status: { isStreaming: true, isCompacting: false, isBashRunning: false }, seq: 2 });
    await waitFor(f.store, () => f.store.getSnapshot().status?.isStreaming === true);
    expect(f.store.getSnapshot().transcript.messages.map(messageText)).toEqual(["first contribution", "second contribution", "classic live reply"]);
  });

  it("does not let later host output hide a native completion checkpoint, and keeps errors, commands, dialogs and tree notifications", async () => {
    const f = await fixture();
    await join(f);
    f.emit({ type: "shell.start", command: "running shell", seq: 20 });
    f.emit({ type: "shell.chunk", chunk: "output after cut", seq: 21 });
    f.emit({ type: "session.error", message: "visible native failure", seq: 22 });
    f.emit({ type: "command.output", level: "info", message: "command completed", seq: 23 });
    f.emit({ type: "pi.event", eventType: "session_tree", seq: 24 });
    await waitFor(f.store, () => f.store.getSnapshot().commandResult?.type === "done");
    const completed = openFixture({ session: { id: "native", cwd: "/temporary" }, readPath: "native", epoch: "one", snapshot: { seq: 10, partial: null },
      page: { start: 0, total: 3, messages: [...snapshot().history.messages, { id: "completed", role: "assistant", content: "new native completion" }] },
      status: { isStreaming: false, isCompacting: false, isBashRunning: true, pendingDialogs: [{ kind: "confirm", dialogId: "dialog", title: "Confirm", message: "Continue?", askedAt: "2026-10-15T00:00:00Z" }] } });
    f.emit({ type: "session.open", open: completed });
    await waitFor(f.store, () => f.store.getSnapshot().transcript.messages.some(message => messageText(message) === "new native completion"));
    expect(f.store.getSnapshot().transcript.messages.filter(message => messageText(message) === "new native completion")).toHaveLength(1);
    expect(f.store.getSnapshot().transcript.messages.at(-1)?.parts).toMatchObject([{ type: "shell", run: { result: { type: "running", output: "output after cut" } } }]);
    expect(f.store.getSnapshot().transcript.error).toBe("visible native failure");
    expect(f.store.getSnapshot().commandResult).toMatchObject({ type: "done", message: "command completed" });
    expect(f.store.getSnapshot().status?.pendingDialogs).toMatchObject([{ dialogId: "dialog" }]);
    expect(f.piEvents).toEqual(["session_tree"]);
    f.emit({ type: "status.update", seq: 25, status: { isStreaming: true, isCompacting: true, isBashRunning: false } });
    f.emit({ type: "assistant.delta", text: "stale SDK projection", seq: 26 });
    await new Promise(resolve => { setTimeout(resolve, 20); });
    expect(f.store.getSnapshot().status?.isStreaming).toBe(false);
    expect(f.store.getSnapshot().status?.isCompacting).toBe(false);
    expect(f.store.getSnapshot().transcript.messages.map(messageText)).not.toContain("stale SDK projection");
  });
  it.each([1, 2])("replays a late native cut without duplicating %i completed identical shell runs", async count => {
    const f = await fixture(); await join(f);
    for (let index = 0; index < count; index++) {
      f.emit({ type: "shell.start", command: "same command", seq: 20 + index * 3 });
      f.emit({ type: "shell.chunk", chunk: "same output", seq: 21 + index * 3 });
      f.emit({ type: "shell.end", output: "same output", exitCode: 0, seq: 22 + index * 3 });
    }
    await waitFor(f.store, () => f.store.getSnapshot().transcript.messages.filter(message => message.role === "shell").length === count);
    f.emit({ type: "session.open", open: openFixture({ session: { id: "native", cwd: "/temporary" }, readPath: "native", epoch: "one", snapshot: { seq: 10, partial: null },
      page: { start: 0, total: 3, messages: [...snapshot().history.messages, { id: "cut", role: "assistant", content: "late cut" }] } }) });
    await waitFor(f.store, () => f.store.getSnapshot().transcript.messages.some(message => messageText(message) === "late cut"));
    const shells = f.store.getSnapshot().transcript.messages.filter(message => message.role === "shell");
    expect(shells).toHaveLength(count);
    expect(new Set(shells.map(message => message.id)).size).toBe(count);
    expect(shells.every(message => message.parts[0]?.type === "shell" && message.parts[0].run.result.type === "done")).toBe(true);
  });

  it.each([[true, false], [false, false], [true, true]] as const)("keeps a current-run error across a real tool handOver and clears it only on a real new run (observe before run=%s, steer=%s)", async (observeBeforeRun, steer) => {
    const f = await fixture();
    let seq = 0;
    const boundaries = new DurableRunBoundaries(() => ++seq);
    const provider = fauxProvider(), models = createModels(), registry = createRegistry();
    models.setProvider(provider.provider);
    let releaseTool!: () => void, releaseAnswer!: () => void, releaseNextRun!: () => void;
    const toolHeld = new Promise<void>(resolve => { releaseTool = resolve; });
    const answerHeld = new Promise<void>(resolve => { releaseAnswer = resolve; });
    const nextRunHeld = new Promise<void>(resolve => { releaseNextRun = resolve; });
    registry.install(defineExtension({ name: "handover-test", tools: [defineTool({ name: "held_tool", description: "Hold the tool turn", parameters: Type.Object({}), replay: "unsafe",
      execute: async (_args, api) => { api.output("tool held"); await toolHeld; return { content: [{ type: "text", text: "tool finished" }] }; } })] }));
    provider.setResponses([
      fauxAssistantMessage([fauxToolCall("held_tool", {})], { stopReason: "toolUse" }),
      async () => { await answerHeld; return fauxAssistantMessage("first run finished"); },
      async () => { await nextRunHeld; return fauxAssistantMessage("new run finished"); },
    ]);
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
    const conversation = await harness.root(context);
    const model = provider.getModel();
    await conversation.configure({ model: { provider: model.provider, modelId: model.id } }, context);
    const stopNative = harness.subscribeCommits(() => { seq++; });
    // The real Durable writer and production run observer own the changing state.
    // This cut fixture supplies the browser envelope without importing the server TS project.
    const cut = async () => {
      const live = await harness.snapshot(LiveDoc, conversation.id, context);
      const entries = await conversation.entries({ order: "ascending" }, 100, undefined, context);
      const messages = entries.items.flatMap(entry => (entry.model ?? []).map((message, index) => ({ ...message, id: `entry:${String(entry.conversationId)}:${String(entry.id)}:${String(index)}` })));
      const runStartSeq = boundaries.checkpoint("native", harness, conversation.id, live?.run?.inputs[0]);
      return sessionOpenSchema.parse({ ...openFixture({ session: { id: "native", cwd: "/temporary" }, readPath: "native", epoch: "one",
        snapshot: { seq, partial: null }, page: { start: 0, total: messages.length, messages },
        status: { isStreaming: live?.run !== undefined, isCompacting: false, isBashRunning: false } }), runStartSeq });
    };
    try {
      const startStore = async () => {
        const starting = f.store.start();
        await vi.waitFor(() => { expect(f.requests).toContain("/api/sessions/native/open"); });
        f.publishOpen(await cut()); await starting;
      };
      if (observeBeforeRun) await startStore();
      harness.resume();
      const submission = await conversation.submit({ type: "input", content: "use the held tool" }, context);
      await vi.waitFor(async () => { expect((await harness.snapshot(LiveDoc, conversation.id, context))?.tools?.[0]?.output).toBe("tool held"); });
      if (!observeBeforeRun) await startStore();
      const before = await harness.snapshot(LiveDoc, conversation.id, context);
      const toolCut = await cut(); f.publishOpen(toolCut);
      if (observeBeforeRun) expect(toolCut.runStartSeq).toBeGreaterThan(0);
      else expect(toolCut.runStartSeq).toBe(0);
      await waitFor(f.store, () => f.store.getSnapshot().status?.isStreaming === true);
      const errorSeq = ++seq;
      f.emit({ type: "session.error", message: "current tool-run error", seq: errorSeq });
      await waitFor(f.store, () => f.store.getSnapshot().transcript.error === "current tool-run error");
      const steered = steer ? await conversation.submit({ type: "input", content: "steer the same run", whenBusy: "steer" }, context) : undefined;
      releaseTool();
      await vi.waitFor(() => { expect(provider.state.callCount).toBe(2); });
      const after = await harness.snapshot(LiveDoc, conversation.id, context);
      expect(after?.run?.taskId).not.toBe(before?.run?.taskId);
      expect(after?.run?.inputs).toEqual(steered === undefined ? before?.run?.inputs : [...(before?.run?.inputs ?? []), steered.id]);
      const handedOver = await cut(); f.publishOpen(handedOver);
      await waitFor(f.store, () => f.store.getSnapshot().transcript.messages.some(message => message.parts.some(part => part.type === "tool" && part.state.type === "done" && part.state.output === "tool finished")));
      expect(f.store.getSnapshot().transcript.error).toBe("current tool-run error");
      expect(handedOver.runStartSeq).toBe(toolCut.runStartSeq);
      releaseAnswer(); await submission.wait(context); await conversation.waitForIdle(context);
      f.publishOpen(await cut());
      await waitFor(f.store, () => f.store.getSnapshot().status?.isStreaming === false);
      expect(f.store.getSnapshot().transcript.error).toBe("current tool-run error");
      const next = await conversation.submit({ type: "input", content: "start a real new run" }, context);
      await vi.waitFor(() => { expect(provider.state.callCount).toBe(3); });
      const newRun = await cut(); f.publishOpen(newRun);
      await waitFor(f.store, () => f.store.getSnapshot().status?.isStreaming === true);
      expect(newRun.runStartSeq).toBeGreaterThan(errorSeq);
      expect(f.store.getSnapshot().transcript.error).toBeUndefined();
      releaseNextRun(); await next.wait(context); await conversation.waitForIdle(context);
    } finally { releaseTool(); releaseAnswer(); releaseNextRun(); await conversation.waitForIdle(context); stopNative(); await harness.close(context); }
  });

  it.each([true, false])("reports the same dismissed failure again after a native run boundary (streaming=%s)", async streaming => {
    const f = await fixture(); await join(f);
    f.emit({ type: "session.error", message: "same native failure", seq: 1 });
    await waitFor(f.store, () => f.store.getSnapshot().problems.length === 1);
    f.store.dismissProblems();
    expect(f.store.getSnapshot().problems).toEqual([]);
    f.emit({ type: "session.open", open: { ...openFixture({ session: { id: "native", cwd: "/temporary" }, readPath: "native", epoch: "one", snapshot: { seq: 10, partial: null },
      page: { start: 0, total: 3, messages: [...snapshot().history.messages, { id: "next-run", role: "user", content: "next run input" }] },
      status: { isStreaming: streaming, isCompacting: false, isBashRunning: false } }), runStartSeq: 5 } });
    await waitFor(f.store, () => f.store.getSnapshot().transcript.messages.some(message => message.id === "next-run"));
    expect(f.store.getSnapshot().transcript.error).toBeUndefined();
    f.emit({ type: "session.error", message: "same native failure", seq: 11 });
    await waitFor(f.store, () => f.store.getSnapshot().problems.length === 1);
    expect(f.store.getSnapshot().problems[0]).toMatchObject({ title: "Pi reported an error", message: "same native failure" });
  });

  it.each([10, 30])("keeps a new error across a run-boundary cut at seq %i and never re-reports a dismissed replay", async cutSeq => {
    const f = await fixture(); await join(f);
    f.emit({ type: "session.error", message: "same native failure", seq: 1 });
    await waitFor(f.store, () => f.store.getSnapshot().problems.length === 1);
    f.store.dismissProblems();
    f.emit({ type: "session.error", message: "same native failure", seq: 20 });
    const cut = { ...openFixture({ session: { id: "native", cwd: "/temporary" }, readPath: "native", epoch: "one", snapshot: { seq: cutSeq, partial: null },
      page: { start: 0, total: 3, messages: [...snapshot().history.messages, { id: "new-run-cut", role: "user", content: "new run cut" }] },
      status: { isStreaming: true, isCompacting: false, isBashRunning: false } }), runStartSeq: 5 };
    f.emit({ type: "session.open", open: cut });
    await waitFor(f.store, () => f.store.getSnapshot().transcript.messages.some(message => message.id === "new-run-cut"));
    expect(f.store.getSnapshot().transcript.error).toBe("same native failure");
    expect(f.store.getSnapshot().problems).toHaveLength(1);
    f.store.dismissProblems();
    f.emit({ type: "session.open", open: { ...cut, seq: 31, snapshot: { ...cut.snapshot, seq: 31 }, status: { ...cut.status, isStreaming: false } } });
    await waitFor(f.store, () => f.store.getSnapshot().status?.isStreaming === false);
    expect(f.store.getSnapshot().transcript.error).toBe("same native failure");
    expect(f.store.getSnapshot().problems).toEqual([]);
  });

  it("keeps an initial host error covered by the native cut when no later run start covers it", async () => {
    const f = await fixture();
    const starting = f.store.start();
    await vi.waitFor(() => { expect(f.requests).toContain("/api/sessions/native/open"); });
    f.emit({ type: "session.error", message: "initial native failure", seq: 8 });
    f.emit(snapshot(1));
    await starting;
    await waitFor(f.store, () => f.store.getSnapshot().connection.type === "ready");
    expect(f.store.getSnapshot().transcript.error).toBe("initial native failure");
    expect(f.store.getSnapshot().problems).toHaveLength(1);
  });

  it("joins from one HTTP open seed plus the socket without separate history, partial, or status reads", async () => {
    const f = await fixture();
    await join(f);
    await waitFor(f.store, () => f.store.getSnapshot().commands.type === "ready");
    expect(f.requests).toEqual(["/api/sessions/native/open", "/api/sessions/native/commands"]);
    expect(f.store.getSnapshot().transcript.messages.map(messageText)).toEqual(["first contribution", "second contribution"]);
  });

  it("retains two distinct disclosure identities with equal timestamps and ignores duplicate revisions and SDK deltas", async () => {
    const f = await fixture();
    await join(f);
    const ids = f.store.getSnapshot().transcript.messages.map((message) => message.id);
    f.emit({ ...snapshot(1), history: { ...snapshot().history, messages: [...snapshot().history.messages, { id: "new", role: "assistant", content: "new committed answer", timestamp: 2 }], total: 3 } });
    await waitFor(f.store, () => f.store.getSnapshot().transcript.messages.length === 3);
    expect(f.store.getSnapshot().transcript.messages.slice(0, 2).map((message) => message.id)).toEqual(ids);
    expect(new Set(f.store.getSnapshot().transcript.messages.map((message) => message.id)).size).toBe(3);
    f.emit({ type: "assistant.delta", text: "not authority", seq: 100 });
    f.emit(snapshot(1));
    f.emit(snapshot(0));
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(f.store.getSnapshot().transcript.messages.map(messageText)).toEqual(["first contribution", "second contribution", "new committed answer"]);
  });

  it("reconciles current tools and ask ID while retaining unsaved running shell output", async () => {
    const f = await fixture();
    const frame = snapshot();
    frame.isStreaming = true;
    frame.history.messages.push({ id: "tool-message", role: "assistant", content: [{ type: "toolCall", id: "call", name: "read", arguments: {} }] });
    frame.tools = [{ toolCallId: "call", toolName: "read", status: "running", output: "saved progress" }];
    frame.app = { response: { kind: "needs-response", reason: "questions" }, pendingAsk: { askId: "ask-one", askedAt: "now", questions: [{ id: "q", question: "Choose", options: [] }] } };
    await join(f, frame);
    expect(f.store.getSnapshot().ask).toMatchObject({ type: "open", ask: { askId: "ask-one" } });
    expect(f.store.getSnapshot().transcript.messages.at(-1)?.parts).toMatchObject([{ type: "tool", state: { type: "running", output: "saved progress" } }]);
    f.emit({ type: "shell.start", command: "pending command", seq: 1 });
    f.emit({ type: "shell.chunk", chunk: "unsaved output", seq: 2 });
    await waitFor(f.store, () => f.store.getSnapshot().transcript.messages.some((message) => message.role === "shell"));
    f.emit({ ...frame, revision: 1, app: { response: { kind: "none" } } });
    await waitFor(f.store, () => f.store.getSnapshot().ask.type === "none");
    expect(f.store.getSnapshot().transcript.messages.at(-1)?.parts).toMatchObject([{ type: "shell", run: { result: { type: "running", output: "unsaved output" } } }]);
  });

  it("accepts a fresh reconnect epoch without replaying the old connection's effects", async () => {
    const f = await fixture();
    await join(f);
    const ids = f.store.getSnapshot().transcript.messages.map((message) => message.id);
    f.close();
    await waitFor(f.store, () => f.store.getSnapshot().connection.type === "reconnecting");
    await new Promise<void>((resolve, reject) => {
      const tick = setInterval(() => { if (f.connections() === 2) { clearInterval(tick); clearTimeout(timeout); resolve(); } }, 5);
      const timeout = setTimeout(() => { clearInterval(tick); reject(new Error("No reconnect")); }, 2000);
    });
    f.emit(snapshot(0, "new-daemon"));
    await waitFor(f.store, () => f.store.getSnapshot().connection.type === "ready");
    expect(f.store.getSnapshot().transcript.messages.map((message) => message.id)).toEqual(ids);
    expect(f.requests.filter(path => path.endsWith("/open"))).toHaveLength(2);
    expect(f.requests.every((path) => path.endsWith("/commands") || path.endsWith("/open"))).toBe(true);
  });
});
