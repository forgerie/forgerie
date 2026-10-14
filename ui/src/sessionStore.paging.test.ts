import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionStore } from "./sessionStore";
import { threadMessageIdAt } from "./transcript";
import { createOpenServer, openFixture } from "./testing/openFixture";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const messages = Array.from({ length: 12 }, (_, index) => ({ id: `m${String(index)}`, role: index % 2 === 0 ? "user" : "assistant", content: `message ${String(index)}` }));

describe("absolute complete-turn history windows", () => {
  it("shares one older read, preserves objects and resolves search positions outside the first page", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const server = await createOpenServer(async url => {
      if (url.pathname.endsWith("/open")) return openFixture({ page: { messages: messages.slice(8), start: 8, total: 12 } });
      if (url.pathname.endsWith("/messages")) { await gate; const before = Number(url.searchParams.get("before")); return { messages: messages.slice(Math.max(0, before - 4), before), start: Math.max(0, before - 4), total: 12, historyId: "test-history", epoch: "test-daemon", seq: 0 }; }
      return [];
    }); cleanup.push(server.close);
    const store = createSessionStore("known", server.transport, {}, { id: "known", cwd: "/workspace" }); cleanup.push(store.dispose);
    await store.start(); const tail = store.getSnapshot().transcript.messages[0];
    expect(tail?.position).toBe(8);
    const first = store.loadEarlier(), second = store.loadEarlier(); expect(first).toBe(second);
    await vi.waitFor(() => expect(store.getSnapshot().earlier.type).toBe("loading"));
    release(); await first;
    expect(store.getSnapshot().transcript.messages.find(message => message.position === 8)).toBe(tail);
    expect(server.requests.filter(url => url.pathname.endsWith("/messages"))).toHaveLength(1);
    await store.ensurePosition(1);
    expect(store.getSnapshot().earlier.type).toBe("complete");
    expect(threadMessageIdAt(store.getSnapshot().transcript.messages, 1)).toBe("m1");
    expect(store.getSnapshot().transcript.messages.map(message => message.position)).toEqual(Array.from({ length: 12 }, (_, index) => index));
  });
  it("failed reads leave the window and identities unchanged and permit retry", async () => {
    let failed = true;
    const server = await createOpenServer(url => {
      if (url.pathname.endsWith("/open")) return openFixture({ page: { messages: messages.slice(8), start: 8, total: 12 } });
      if (url.pathname.endsWith("/messages")) return failed ? Response.json({ error: "read unavailable" }, { status: 503 }) : { messages: messages.slice(4, 8), start: 4, total: 12, historyId: "test-history", epoch: "test-daemon", seq: 0 };
      return [];
    }); cleanup.push(server.close);
    const store = createSessionStore("known", server.transport, {}, { id: "known", cwd: "/workspace" }); cleanup.push(store.dispose);
    await store.start(); const before = store.getSnapshot().transcript.messages;
    await expect(store.loadEarlier()).rejects.toThrow("unavailable");
    expect(store.getSnapshot().transcript.messages).toBe(before); expect(store.getSnapshot().earlier.type).toBe("failed");
    failed = false; await store.loadEarlier(); expect(store.getSnapshot().transcript.messages).toHaveLength(8);
  });
});

it("resolves an old joined-assistant search target and reads its full-tree entry outside the tail page", async () => {
  const history = Array.from({ length: 3 }, (_, turn) => [
    { id: `u${String(turn)}`, role: "user", content: `input ${String(turn)}` },
    { id: `plan${String(turn)}`, role: "assistant", content: [{ type: "thinking", thinking: "plan" }] },
    { id: `answer${String(turn)}`, role: "assistant", content: `answer ${String(turn)}` },
  ]).flat();
  const server = await createOpenServer(url => {
    if (url.pathname.endsWith("/open")) return openFixture({ page: { messages: history.slice(6), start: 6, total: 9 } });
    if (url.pathname.endsWith("/messages")) return { messages: history.slice(0, 6), start: 0, total: 9, historyId: "test-history", epoch: "test-daemon", seq: 0 };
    if (url.pathname.endsWith("/tree")) return { tree: { nodes: [{ id: "u0", parentId: null, kind: "user", summary: "old input" }, { id: "answer0", parentId: "u0", kind: "assistant", summary: "old answer" }], activeLeafId: "answer0", activePathIds: ["u0", "answer0"] } };
    return [];
  }); cleanup.push(server.close);
  const store = createSessionStore("known", server.transport, {}, { id: "known", cwd: "/workspace" }); cleanup.push(store.dispose);
  await store.start(); expect(store.getSnapshot().transcript.messages.some(message => message.position === 2)).toBe(false);
  await store.viewTree(); expect(store.getSnapshot().tree).toMatchObject({ type: "open", tree: { nodes: [expect.anything(), { id: "answer0" }] } });
  await store.ensurePosition(2);
  expect(threadMessageIdAt(store.getSnapshot().transcript.messages, 2)).toBe("plan0");
  expect(server.requests.filter(url => url.pathname.endsWith("/messages"))).toHaveLength(1);
});
