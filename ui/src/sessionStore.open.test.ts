import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionStore } from "./sessionStore";
import { createReadTracker } from "./readReceipt";
import { messageText } from "./transcript";
import { createOpenServer, openFixture } from "./testing/openFixture";
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

it("acknowledges the exact hidden completion receipt only after that entry becomes visibly selected", async () => {
  let observer: ((id: string, receipt?: { catalogId: string; throughCompletionOrder: number }) => void) | undefined;
  let documentVisible = false;
  const server = await createOpenServer(url => url.pathname.endsWith("/open") ? openFixture() : { catalogId: "epoch", sessions: [] }); cleanup.push(server.close);
  const reads = createReadTracker(server.transport, { isVisible: () => documentVisible, subscribe: listener => { observer = listener; return () => { observer = undefined; }; }, afterRender: async () => {} });
  const store = createSessionStore("known", server.transport, {}, session, reads); cleanup.push(store.dispose);
  await store.start(); observer?.("known", { catalogId: "epoch", throughCompletionOrder: 7 });
  store.setVisible(true); await new Promise(resolve => setTimeout(resolve, 10));
  expect(server.requests.some(url => url.pathname.endsWith("/unread/acknowledge"))).toBe(false);
  documentVisible = true; store.setVisible(false); store.setVisible(true);
  await vi.waitFor(() => expect(server.requests.filter(url => url.pathname.endsWith("/unread/acknowledge"))).toHaveLength(1));
});
