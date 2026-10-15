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

it("replaces the authoritative window after a 409 for before=150 when a 200-message branch shrinks to one", async () => {
  const long = Array.from({ length: 200 }, (_, index) => ({ id: `m${String(index)}`, role: index % 2 === 0 ? "user" : "assistant", content: `message ${String(index)}` }));
  let opens = 0;
  let release!: () => void;
  const replacement = new Promise<void>(resolve => { release = resolve; });
  const server = await createOpenServer(async url => {
    if (url.pathname.endsWith("/open")) {
      if (++opens === 1) return openFixture({ historyId: "before-shrink", page: { messages: long.slice(150), start: 150, total: 200 } });
      await replacement;
      return openFixture({ historyId: "after-shrink", page: { messages: [{ id: "replacement", role: "user", content: "new branch" }], start: 0, total: 1 } });
    }
    if (url.pathname.endsWith("/messages")) return Response.json({ error: "Session history changed", code: "HISTORY_CHANGED" }, { status: 409 });
    return [];
  }); cleanup.push(server.close); cleanup.push(() => { release(); });
  const store = createSessionStore("known", server.transport, {}, { id: "known", cwd: "/workspace" }); cleanup.push(store.dispose);
  await store.start(); const previous = store.getSnapshot().transcript.messages;
  await expect(store.loadEarlier()).rejects.toThrow("Session history changed");
  await vi.waitFor(() => expect(opens).toBe(2));
  expect(server.requests.find(url => url.pathname.endsWith("/messages"))?.searchParams.toString()).toBe("cwd=%2Fworkspace&before=150&limit=50&historyId=before-shrink");
  expect(store.getSnapshot().transcript.messages).toBe(previous);
  release();
  await vi.waitFor(() => expect(store.getSnapshot().transcript.messages.map(message => message.id)).toEqual(["replacement"]));
  expect(store.getSnapshot().transcript.messages[0]?.position).toBe(0);
  expect(store.getSnapshot().earlier.type).toBe("complete");
  await store.loadEarlier();
  expect(server.requests.filter(url => url.pathname.endsWith("/messages"))).toHaveLength(1);
});


it("keeps loaded native earlier turns and their identities when the live replacement tail advances", async () => {
  const all = Array.from({ length: 14 }, (_, index) => ({ id: `m${String(index)}`, role: index % 2 === 0 ? "user" : "assistant", content: `message ${String(index)}` }));
  const server = await createOpenServer(url => {
    if (url.pathname.endsWith("/open")) return openFixture({ readPath: "native", page: { messages: all.slice(8, 12), start: 8, total: 12 } });
    if (url.pathname.endsWith("/messages")) {
      const before = Number(url.searchParams.get("before"));
      return { messages: all.slice(Math.max(0, before - 4), before), start: Math.max(0, before - 4), total: 14, historyId: "test-history", epoch: "test-daemon", seq: 0 };
    }
    return [];
  }); cleanup.push(server.close);
  const store = createSessionStore("known", { ...server.transport, nativeReadModel: true }, {}, { id: "known", cwd: "/workspace" }); cleanup.push(store.dispose);
  await store.start(); await store.loadEarlier();
  const older = store.getSnapshot().transcript.messages[0];
  expect(older?.position).toBe(4);
  server.emit({ type: "session.open", open: openFixture({ readPath: "native", snapshot: { seq: 1, partial: null }, page: { messages: all.slice(10), start: 10, total: 14 } }) });
  await vi.waitFor(() => expect(store.getSnapshot().transcript.messages.at(-1)?.position).toBe(13));
  expect(store.getSnapshot().transcript.messages.map(message => message.position)).toEqual(Array.from({ length: 10 }, (_, index) => index + 4));
  expect(store.getSnapshot().transcript.messages[0]).toBe(older);
  await store.loadEarlier();
  expect(server.requests.filter(url => url.pathname.endsWith("/messages")).map(url => url.searchParams.get("before"))).toEqual(["8", "4"]);
  expect(store.getSnapshot().transcript.messages.map(message => message.position)).toEqual(Array.from({ length: 14 }, (_, index) => index));
  server.emit({ type: "session.open", open: openFixture({ readPath: "native", historyId: "new-branch", snapshot: { seq: 2, partial: null }, page: { messages: [{ id: "new", role: "user", content: "replacement branch" }], start: 0, total: 1 } }) });
  await vi.waitFor(() => expect(store.getSnapshot().transcript.messages.map(message => message.id)).toEqual(["new"]));
});


it("finishes an in-flight native prepend after a same-history live checkpoint advances the tail", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); cleanup.push(() => { release(); });
  const server = await createOpenServer(async url => {
    if (url.pathname.endsWith("/open")) return openFixture({ readPath: "native", page: { messages: messages.slice(8), start: 8, total: 12 } });
    if (url.pathname.endsWith("/messages")) { await gate; return { messages: messages.slice(4, 8), start: 4, total: 12, historyId: "test-history", epoch: "test-daemon", seq: 0 }; }
    return [];
  }); cleanup.push(server.close);
  const store = createSessionStore("known", { ...server.transport, nativeReadModel: true }, {}, { id: "known", cwd: "/workspace" }); cleanup.push(store.dispose);
  await store.start(); const tail = store.getSnapshot().transcript.messages[0];
  const earlier = store.loadEarlier();
  const next = [...messages.slice(10), { id: "m12", role: "user", content: "next input" }, { id: "m13", role: "assistant", content: "next answer" }];
  server.emit({ type: "session.open", open: openFixture({ readPath: "native", snapshot: { seq: 1, partial: null }, page: { messages: next, start: 10, total: 14 } }) });
  await vi.waitFor(() => expect(store.getSnapshot().transcript.messages.at(-1)?.position).toBe(13));
  release(); await earlier;
  expect(store.getSnapshot().transcript.messages.map(message => message.position)).toEqual(Array.from({ length: 10 }, (_, index) => index + 4));
  expect(store.getSnapshot().transcript.messages.find(message => message.position === 8)).toBe(tail);
  await store.ensurePosition(13);
});
