import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionStore } from "./sessionStore";
import { createReadTracker } from "./readReceipt";
import { messageText } from "./transcript";
import { createOpenServer, openFixture } from "./testing/openFixture";
import { sessionWireChunks } from "@shared/sessionWire";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const session = { id: "known", cwd: "/workspace" };
function held() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

describe("one-read chat open", () => {
  it("opens with exactly one transcript HTTP read and replays only events above the cut, including sequence gaps", async () => {
    const gate = held();
    const server = await createOpenServer(async url => {
      if (url.pathname.endsWith("/open")) { await gate.promise; return openFixture({ snapshot: { seq: 4, partial: { role: "assistant", content: "one" } }, status: { isStreaming: true, isCompacting: false, isBashRunning: false } }); }
      return [];
    }); cleanup.push(server.close);
    const store = createSessionStore("known", server.transport, {}, session); cleanup.push(store.dispose);
    const starting = store.start();
    await vi.waitFor(() => expect(server.requests.some(url => url.pathname.endsWith("/open"))).toBe(true));
    server.emit({ type: "assistant.delta", text: "one", seq: 4 });
    server.emit({ type: "assistant.delta", text: " two", seq: 9 });
    gate.release(); await starting;
    expect(store.getSnapshot().transcript.messages.map(messageText)).toEqual(["one two"]);
    expect(server.requests.filter(url => /\/(open|messages|status|stream-snapshot)$/u.test(url.pathname)).map(url => url.pathname)).toEqual(["/api/sessions/known/open"]);
  });
  it("keeps the final reply when it completes while the screen is hidden", async () => {
    const server = await createOpenServer(url => url.pathname.endsWith("/open") ? openFixture({ snapshot: { seq: 0, partial: { role: "assistant", content: "working" } }, status: { isStreaming: true, isCompacting: false, isBashRunning: false } }) : []); cleanup.push(server.close);
    const store = createSessionStore("known", server.transport, {}, session); cleanup.push(store.dispose);
    await store.start(); store.setVisible(false);
    server.emit({ type: "message.end", message: { role: "assistant", id: "answer", content: "final text", timestamp: 2 }, seq: 2 });
    server.emit({ type: "agent.end", seq: 3 });
    await vi.waitFor(() => expect(store.getSnapshot().transcript.isRunning).toBe(false));
    const reads = server.requests.length;
    store.setVisible(true);
    expect(store.getSnapshot().transcript.messages.map(messageText)).toEqual(["final text"]);
    expect(server.requests).toHaveLength(reads);
  });
  it("rejects a late HTTP seed older than an already received native checkpoint", async () => {
    const gate = held();
    const server = await createOpenServer(async url => { if (!url.pathname.endsWith("/open")) return []; await gate.promise; return openFixture({ page: { messages: [{ role: "user", content: "stale" }], start: 0, total: 1 } }); }); cleanup.push(server.close);
    const store = createSessionStore("known", server.transport, {}, session); cleanup.push(store.dispose);
    const starting = store.start(); await vi.waitFor(() => expect(server.requests).toHaveLength(1));
    server.emit({ type: "session.open", open: openFixture({ page: { messages: [{ role: "user", content: "new committed text" }], start: 0, total: 1 }, snapshot: { seq: 5, partial: null } }) });
    await new Promise(resolve => setTimeout(resolve, 15)); gate.release(); await starting;
    expect(store.getSnapshot().transcript.messages.map(messageText)).toEqual(["new committed text"]);
  });
  it("applies a large chunked native cut atomically and retains newer interleaved host output", async () => {
    const initial = openFixture({ readPath: "native", page: { messages: [{ id: "u", role: "user", content: "input" }], start: 0, total: 1 } });
    const server = await createOpenServer(url => url.pathname.endsWith("/open") ? initial : []); cleanup.push(server.close);
    server.transport.nativeReadModel = true;
    const store = createSessionStore("known", server.transport, {}, session); cleanup.push(store.dispose);
    await store.start();
    const text = "界🌍".repeat(1_300_000);
    const open = openFixture({ readPath: "native", page: { messages: [{ id: "u", role: "user", content: "input" }, { id: "a", role: "assistant", content: text }], start: 0, total: 2 }, snapshot: { seq: 5, partial: null } });
    const frames = [...sessionWireChunks(JSON.stringify({ type: "session.open", open }), "large-cut")];
    const emit = (frame: string) => { const value: unknown = JSON.parse(frame); server.emit(value); };
    for (const frame of frames.slice(0, -1)) emit(frame);
    server.emit({ type: "shell.start", command: "echo retained", seq: 7 });
    server.emit({ type: "shell.end", output: "retained", exitCode: 0, seq: 8 });
    await vi.waitFor(() => expect(store.getSnapshot().transcript.messages.some(message => message.parts.some(part => part.type === "shell" && part.run.result.output === "retained"))).toBe(true));
    expect(store.getSnapshot().transcript.messages.some(message => message.key === "a")).toBe(false);
    emit(frames.at(-1) ?? "");
    await vi.waitFor(() => expect(store.getSnapshot().transcript.messages.find(message => message.key === "a")?.parts).toBeDefined());
    const reply = store.getSnapshot().transcript.messages.find(message => message.key === "a");
    expect(reply && messageText(reply)).toBe(text);
    expect(store.getSnapshot().transcript.messages.some(message => message.parts.some(part => part.type === "shell" && part.run.result.output === "retained"))).toBe(true);
    expect(store.getSnapshot().connection.type).toBe("ready");
  });

  it.each(["HTTP", "socket"] as const)("keeps the newer %s cut when HTTP finishes during chunk assembly", async winner => {
    const gate = held(); cleanup.push(gate.release);
    const http = openFixture({ readPath: "native", page: { messages: [{ role: "user", content: "HTTP cut" }], start: 0, total: 1 }, snapshot: { seq: winner === "HTTP" ? 7 : 3, partial: null } });
    const server = await createOpenServer(async url => { if (!url.pathname.endsWith("/open")) return []; await gate.promise; return http; }); cleanup.push(server.close);
    server.transport.nativeReadModel = true;
    let received = 0;
    const connect = server.transport.connect;
    server.transport.connect = path => { const socket = connect(path); socket.addEventListener("message", () => { received++; }); return socket; };
    const store = createSessionStore("known", server.transport, {}, session); cleanup.push(store.dispose);
    const starting = store.start();
    await vi.waitFor(() => expect(server.requests.some(url => url.pathname.endsWith("/open"))).toBe(true));
    const text = "socket cut".repeat(10_000);
    const open = openFixture({ readPath: "native", page: { messages: [{ role: "user", content: text }], start: 0, total: 1 }, snapshot: { seq: winner === "socket" ? 7 : 3, partial: null } });
    const frames = [...sessionWireChunks(JSON.stringify({ type: "session.open", open }), "racing-cut")];
    for (const frame of frames.slice(0, -1)) { const value: unknown = JSON.parse(frame); server.emit(value); }
    gate.release(); await starting;
    expect(store.getSnapshot().transcript.messages.map(messageText)).toEqual(["HTTP cut"]);
    const final: unknown = JSON.parse(frames.at(-1) ?? ""); server.emit(final);
    await vi.waitFor(() => expect(received).toBe(frames.length));
    const expected = winner === "HTTP" ? "HTTP cut" : text;
    await vi.waitFor(() => expect(store.getSnapshot().transcript.messages.map(messageText)).toEqual([expected]));
    expect(store.getSnapshot().connection.type).toBe("ready");
  });

  it("discards an unfinished chunked cut when reconnecting", async () => {
    let opens = 0;
    const server = await createOpenServer(url => url.pathname.endsWith("/open") ? openFixture({ readPath: "native", page: { messages: [{ role: "user", content: ++opens === 1 ? "old" : "reconnected" }], start: 0, total: 1 } }) : []); cleanup.push(server.close);
    server.transport.nativeReadModel = true;
    const store = createSessionStore("known", server.transport, { retryDelayMs: 1 }, session); cleanup.push(store.dispose);
    await store.start();
    const frames = [...sessionWireChunks(JSON.stringify({ type: "session.open", open: { text: "x".repeat(100_000) } }), "unfinished")];
    const first: unknown = JSON.parse(frames[0] ?? ""); server.emit(first);
    for (const socket of server.sockets.clients) socket.close();
    await vi.waitFor(() => expect(store.getSnapshot().transcript.messages.map(messageText)).toEqual(["reconnected"]));
    server.emit({ type: "session.open", open: openFixture({ readPath: "native", page: { messages: [{ role: "user", content: "fresh cut" }], start: 0, total: 1 }, snapshot: { seq: 3, partial: null } }) });
    await vi.waitFor(() => expect(store.getSnapshot().transcript.messages.map(messageText)).toEqual(["fresh cut"]));
    expect(store.getSnapshot().connection.type).toBe("ready");
  });

  it("never acknowledges a prefetched or hidden screen and invalidates a paint wait on switch", async () => {
    const paint = held();
    const server = await createOpenServer(url => url.pathname.endsWith("/open") ? openFixture({ receipt: { catalogId: "captured", throughCompletionOrder: 7 } }) : { catalogId: "captured", sessions: [] }); cleanup.push(server.close);
    const reads = createReadTracker(server.transport, { isVisible: () => true, afterRender: () => paint.promise });
    const store = createSessionStore("known", server.transport, {}, session, reads); cleanup.push(store.dispose);
    await store.start();
    expect(server.requests.some(url => url.pathname.endsWith("/unread/acknowledge"))).toBe(false);
    store.setVisible(true); store.setVisible(false); paint.release();
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(server.requests.some(url => url.pathname.endsWith("/unread/acknowledge"))).toBe(false);
    expect(server.requests.some(url => url.pathname.endsWith("/unread"))).toBe(false);
  });
});

it("keeps today's buffered completion reconciliation for an explicitly sequential facade envelope", async () => {
  const gate = held();
  const server = await createOpenServer(async url => {
    if (!url.pathname.endsWith("/open")) return [];
    await gate.promise;
    return { ...openFixture({ page: { messages: [{ id: "u", role: "user", content: "input", timestamp: 1 }], start: 0, total: 1 }, snapshot: { seq: 4, partial: { role: "assistant", content: "next partial" } }, status: { isStreaming: true, isCompacting: false, isBashRunning: false } }), cut: "sequential", statusSeq: 4 };
  }); cleanup.push(server.close);
  const store = createSessionStore("known", server.transport, {}, session); cleanup.push(store.dispose);
  const starting = store.start();
  await vi.waitFor(() => expect(server.requests.some(url => url.pathname.endsWith("/open"))).toBe(true));
  server.emit({ type: "message.end", message: { role: "assistant", content: "finished between history and partial", timestamp: 2 }, seq: 3 });
  server.emit({ type: "assistant.delta", text: "next partial", seq: 4 });
  server.emit({ type: "assistant.delta", text: " grows", seq: 9 });
  await new Promise(resolve => setTimeout(resolve, 10)); gate.release(); await starting;
  expect(store.getSnapshot().transcript.messages.map(messageText)).toEqual(["input", "finished between history and partial", "next partial grows"]);
});

it("acknowledges a hidden completion only after adopting and painting the transcript that contains it", async () => {
  let observer: ((id: string, receipt?: { catalogId: string; throughCompletionOrder: number }) => void) | undefined;
  let documentVisible = false;
  const paints: { text: string[]; release: () => void }[] = [];
  const replacement = held();
  let opens = 0;
  const server = await createOpenServer(async url => {
    if (!url.pathname.endsWith("/open")) return { catalogId: "epoch", sessions: [] };
    if (++opens === 1) return openFixture({ page: { messages: [{ role: "assistant", content: "OLD answer" }], start: 0, total: 1 } });
    await replacement.promise;
    return openFixture({ page: { messages: [{ role: "assistant", content: "Completion 7: NEW answer" }], start: 0, total: 1 }, receipt: { catalogId: "epoch", throughCompletionOrder: 7 } });
  }); cleanup.push(server.close);
  const acknowledged: { order: unknown; painted: string[]; adopted: string[] }[] = [];
  const request = server.transport.request;
  server.transport.request = async (path, init) => {
    if (path.endsWith("/unread/acknowledge")) acknowledged.push({ order: JSON.parse(String(init.body)).throughCompletionOrder,
      painted: paints.at(-1)?.text ?? [], adopted: store.getSnapshot().transcript.messages.map(messageText) });
    return request(path, init);
  };
  const reads = createReadTracker(server.transport, { isVisible: () => documentVisible,
    subscribe: listener => { observer = listener; return () => { observer = undefined; }; },
    afterRender: () => { const paint = held(); paints.push({ text: store.getSnapshot().transcript.messages.map(messageText), release: paint.release }); return paint.promise; } });
  const store = createSessionStore("known", server.transport, {}, session, reads); cleanup.push(store.dispose);
  cleanup.push(() => { replacement.release(); for (const paint of paints) paint.release(); });
  await store.start();
  for (const order of [5, 6, 7]) observer?.("known", { catalogId: "epoch", throughCompletionOrder: order });
  store.setVisible(true);
  expect(paints).toEqual([]); expect(acknowledged).toEqual([]); expect(opens).toBe(1);
  documentVisible = true; store.setVisible(false); store.setVisible(true);
  await vi.waitFor(() => expect(paints).toHaveLength(1));
  expect(paints[0]?.text).toEqual(["OLD answer"]); expect(opens).toBe(1); expect(acknowledged).toEqual([]);
  paints[0]?.release();
  await vi.waitFor(() => expect(opens).toBe(2));
  expect(store.getSnapshot().transcript.messages.map(messageText)).toEqual(["OLD answer"]); expect(acknowledged).toEqual([]);
  replacement.release();
  await vi.waitFor(() => expect(paints).toHaveLength(2));
  expect(paints[1]?.text).toEqual(["Completion 7: NEW answer"]); expect(acknowledged).toEqual([]);
  paints[1]?.release();
  await vi.waitFor(() => expect(acknowledged).toEqual([{ order: 7, painted: ["Completion 7: NEW answer"], adopted: ["Completion 7: NEW answer"] }]));
  expect(server.requests.filter(url => url.pathname.endsWith("/open"))).toHaveLength(2);
  expect(server.requests.some(url => url.pathname.endsWith("/unread"))).toBe(false);
});

it("never acknowledges a catalog-only boundary while the replacement still contains OLD answer", async () => {
  let observer: ((id: string, receipt?: { catalogId: string; throughCompletionOrder: number }) => void) | undefined;
  const old = openFixture({ page: { messages: [{ role: "assistant", content: "OLD answer" }], start: 0, total: 1 } });
  const server = await createOpenServer(url => url.pathname.endsWith("/open") ? old : { catalogId: "epoch", sessions: [] }); cleanup.push(server.close);
  const reads = createReadTracker(server.transport, { isVisible: () => true,
    subscribe: listener => { observer = listener; return () => { observer = undefined; }; }, afterRender: async () => {} });
  const store = createSessionStore("known", server.transport, {}, session, reads); cleanup.push(store.dispose);
  await store.start(); observer?.("known", { catalogId: "epoch", throughCompletionOrder: 7 }); store.setVisible(true);
  await vi.waitFor(() => expect(server.requests.filter(url => url.pathname.endsWith("/open"))).toHaveLength(2));
  await vi.waitFor(() => expect(store.getSnapshot().connection.type).toBe("ready"));
  expect(store.getSnapshot().transcript.messages.map(messageText)).toEqual(["OLD answer"]);
  expect(server.requests.some(url => url.pathname.endsWith("/unread/acknowledge"))).toBe(false);
});

describe.each(["atomic", "sequential"] as const)("%s cold host-output seed", cut => {
  async function openWithBuffered(options: Parameters<typeof openFixture>[0], events: unknown[], statusSeq?: number) {
    const gate = held();
    const server = await createOpenServer(async url => {
      if (!url.pathname.endsWith("/open")) return [];
      await gate.promise;
      const open = openFixture(options);
      return cut === "sequential" ? { ...open, cut, statusSeq: statusSeq ?? open.seq } : open;
    }); cleanup.push(server.close); cleanup.push(gate.release);
    server.transport.nativeReadModel = options?.readPath === "native";
    const received = vi.fn();
    const connect = server.transport.connect;
    server.transport.connect = path => { const socket = connect(path); socket.addEventListener("message", received); return socket; };
    const store = createSessionStore("known", server.transport, {}, session); cleanup.push(store.dispose);
    const starting = store.start();
    await vi.waitFor(() => expect(server.requests.some(url => url.pathname.endsWith("/open"))).toBe(true));
    for (const event of events) server.emit(event);
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(events.length));
    gate.release(); await starting;
    return store;
  }
  const runs = (store: ReturnType<typeof createSessionStore>) => store.getSnapshot().transcript.messages.flatMap(message => message.parts.flatMap(part => part.type === "shell" ? [part.run] : []));
  it.each(cut === "atomic" ? ["classic", "native"] as const : ["classic"] as const)("reconstructs the running command without an extra unknown placeholder (%s)", async readPath => {
    const store = await openWithBuffered({ readPath, snapshot: { seq: 4, partial: null }, status: { isStreaming: false, isCompacting: false, isBashRunning: true },
      transientEvents: [{ type: "shell.start", command: "sleep 30" }, { type: "shell.chunk", chunk: "hello" }] },
    [{ type: "shell.start", command: "sleep 30", seq: 3 }, { type: "shell.chunk", chunk: "hello", seq: 4 }]);
    expect(runs(store)).toEqual([{ command: "sleep 30", excludeFromContext: false, result: { type: "running", output: "hello" } }]);
  });
  it("applies a buffered completion after reconstructing host output, without a stale running row", async () => {
    const store = await openWithBuffered({ snapshot: { seq: 1, partial: null }, status: { isStreaming: false, isCompacting: false, isBashRunning: false },
      transientEvents: [{ type: "shell.start", command: "sleep 30" }, { type: "shell.chunk", chunk: "hello" }] },
    [{ type: "shell.end", output: "hello FINAL", exitCode: 0, seq: 5 }]);
    expect(runs(store)).toEqual([{ command: "sleep 30", excludeFromContext: false, result: { type: "done", output: "hello FINAL", exitCode: 0, cancelled: false, truncated: false } }]);
  });
  it("does not let the old idle status interrupt a newer buffered command", async () => {
    const store = await openWithBuffered({ snapshot: { seq: 1, partial: null }, status: { isStreaming: false, isCompacting: false, isBashRunning: false },
      transientEvents: [{ type: "shell.start", command: "old" }, { type: "shell.end", output: "old output", exitCode: 0 }] },
    [{ type: "shell.start", command: "new", seq: 5 }, { type: "shell.chunk", chunk: "new output", seq: 6 }]);
    expect(runs(store)).toEqual([
      { command: "old", excludeFromContext: false, result: { type: "done", output: "old output", exitCode: 0, cancelled: false, truncated: false } },
      { command: "new", excludeFromContext: false, result: { type: "running", output: "new output" } },
    ]);
  });
  it("uses a newer buffered start instead of adding an unknown fallback", async () => {
    const store = await openWithBuffered({ snapshot: { seq: 1, partial: null }, status: { isStreaming: false, isCompacting: false, isBashRunning: true } },
    [{ type: "shell.start", command: "known", seq: 5 }, { type: "shell.chunk", chunk: "known output", seq: 6 }]);
    expect(runs(store)).toEqual([{ command: "known", excludeFromContext: false, result: { type: "running", output: "known output" } }]);
  });
  it("keeps one unknown fallback only when host reconstruction is unavailable", async () => {
    const store = await openWithBuffered({ status: { isStreaming: false, isCompacting: false, isBashRunning: true } }, []);
    expect(runs(store)).toEqual([{ result: { type: "running", output: "" } }]);
  });
  if (cut === "sequential") it("uses the host watermark rather than the older partial watermark for shell replay", async () => {
    const store = await openWithBuffered({ snapshot: { seq: 1, partial: null }, status: { isStreaming: false, isCompacting: false, isBashRunning: false },
      transientEvents: [{ type: "shell.start", command: "sleep 30" }, { type: "shell.chunk", chunk: "hello" }] },
    [{ type: "shell.start", command: "sleep 30", seq: 2 }, { type: "shell.chunk", chunk: "hello", seq: 3 }, { type: "shell.end", output: "hello FINAL", exitCode: 0, seq: 5 }], 4);
    expect(runs(store)).toEqual([{ command: "sleep 30", excludeFromContext: false, result: { type: "done", output: "hello FINAL", exitCode: 0, cancelled: false, truncated: false } }]);
  });
});
