import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskActivityStore } from "./taskActivityStore";
import { BUSY, WORKING } from "./fixtures/taskActivity";

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}
const session = () => ({ id: "s 1", cwd: "/w" });

afterEach(() => { vi.useRealTimers(); });

describe("the task activity store", () => {
  it("reads once for a burst of change events, from the session's tasks route", async () => {
    vi.useFakeTimers();
    const request = vi.fn((...args: [string, RequestInit]) => { void args; return respond(200, WORKING); });
    const store = createTaskActivityStore(request, session, { refreshDelayMs: 10 });
    store.refresh(); store.refresh(); store.refresh();
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toBe("/api/sessions/s%201/tasks?cwd=%2Fw");
    expect(store.getSnapshot()).toEqual({ activity: WORKING, reading: false, error: undefined, stale: false });
    store.dispose();
  });

  it("says a first read is in flight", async () => {
    let finish: (response: Response) => void = () => undefined;
    const store = createTaskActivityStore(() => new Promise((resolve) => { finish = resolve; }), session);
    store.retry();
    expect(store.getSnapshot()).toMatchObject({ activity: undefined, reading: true });
    finish(new Response(JSON.stringify(WORKING), { status: 200 }));
    await vi.waitFor(() => expect(store.getSnapshot().reading).toBe(false));
    store.dispose();
  });

  it("keeps the server's words when the first read fails, with no list to show", async () => {
    const store = createTaskActivityStore(() => respond(404, { error: "Session s1 was not found." }), session);
    store.retry();
    await vi.waitFor(() => expect(store.getSnapshot().error).toBe("Session s1 was not found."));
    expect(store.getSnapshot()).toMatchObject({ activity: undefined, stale: false });
    store.dispose();
  });

  it("keeps the last good list, marked stale, when a later read fails, and replaces it when one succeeds", async () => {
    const replies = [respond(200, WORKING), respond(500, "not json"), respond(200, BUSY)];
    const store = createTaskActivityStore(() => replies.shift()!, session);
    store.retry();
    await vi.waitFor(() => expect(store.getSnapshot().activity).toEqual(WORKING));
    store.retry();
    await vi.waitFor(() => expect(store.getSnapshot().error).toBe("HTTP 500"));
    expect(store.getSnapshot()).toMatchObject({ activity: WORKING, stale: true });
    store.retry();
    await vi.waitFor(() => expect(store.getSnapshot().activity).toEqual(BUSY));
    expect(store.getSnapshot()).toMatchObject({ error: undefined, stale: false });
    store.dispose();
  });

  it("refuses a reply that breaks the contract, and keeps the list it had", async () => {
    const replies = [respond(200, WORKING), respond(200, { ...WORKING, tasks: [{ ...WORKING.tasks[0], input: "secret" }] })];
    const store = createTaskActivityStore(() => replies.shift()!, session);
    store.retry();
    await vi.waitFor(() => expect(store.getSnapshot().activity).toEqual(WORKING));
    store.retry();
    await vi.waitFor(() => expect(store.getSnapshot().error).toBe("The server sent task data this page cannot read. Reload the page."));
    expect(store.getSnapshot()).toMatchObject({ activity: WORKING, stale: true });
    store.dispose();
  });

  it("knows a session that is not Durable", async () => {
    const store = createTaskActivityStore(() => respond(200, { kind: "unsupported" }), session);
    store.retry();
    await vi.waitFor(() => expect(store.getSnapshot().activity).toEqual({ kind: "unsupported" }));
    store.dispose();
  });

  it("marks the list stale while the connection is down, and a read after reconnect replaces it", async () => {
    const replies = [respond(200, WORKING), respond(200, BUSY)];
    const store = createTaskActivityStore(() => replies.shift()!, session);
    store.setConnected(false);
    expect(store.getSnapshot().stale).toBe(false);
    store.setConnected(true);
    store.retry();
    await vi.waitFor(() => expect(store.getSnapshot().activity).toEqual(WORKING));
    store.setConnected(false);
    expect(store.getSnapshot()).toMatchObject({ activity: WORKING, stale: true });
    store.setConnected(true);
    expect(store.getSnapshot().stale).toBe(true);
    store.retry();
    await vi.waitFor(() => expect(store.getSnapshot()).toMatchObject({ activity: BUSY, stale: false }));
    store.dispose();
  });

  /** A store with one good list, and a read in flight that the test answers. */
  async function withLateRead(refreshDelayMs = 10) {
    const pending: ((response: Response) => void)[] = [];
    const replies: Promise<Response>[] = [respond(200, WORKING)];
    const store = createTaskActivityStore(() => replies.shift() ?? new Promise((resolve) => { pending.push(resolve); }), session, { refreshDelayMs });
    store.retry();
    await vi.waitFor(() => expect(store.getSnapshot().activity).toEqual(WORKING));
    store.retry();
    expect(store.getSnapshot().reading).toBe(true);
    const answer = (body: unknown) => pending.shift()!(new Response(JSON.stringify(body), { status: 200 }));
    return { store, answer, pending };
  }

  it("keeps the list stale when a read sent before a drop returns while still disconnected", async () => {
    const { store, answer } = await withLateRead();
    store.setConnected(false);
    answer(BUSY);
    await vi.waitFor(() => expect(store.getSnapshot().reading).toBe(false));
    expect(store.getSnapshot()).toMatchObject({ activity: BUSY, stale: true });
    store.dispose();
  });

  it("keeps the list stale when a read sent before a drop returns during the reconnect's debounce", async () => {
    // The debounce is long enough that the late reply lands inside it.
    const { store, answer, pending } = await withLateRead(300);
    store.setConnected(false);
    store.setConnected(true);
    store.refresh();
    answer(BUSY);
    await vi.waitFor(() => expect(store.getSnapshot().activity).toEqual(BUSY));
    expect(store.getSnapshot().stale).toBe(true);
    expect(pending).toHaveLength(0);
    // The reconnect's own read clears it.
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    answer(WORKING);
    await vi.waitFor(() => expect(store.getSnapshot()).toMatchObject({ activity: WORKING, stale: false }));
    store.dispose();
  });

  it("keeps the list stale when a read sent while disconnected returns after the reconnect", async () => {
    const { store, answer } = await withLateRead();
    answer(WORKING);
    await vi.waitFor(() => expect(store.getSnapshot().reading).toBe(false));
    store.setConnected(false);
    store.retry();
    store.setConnected(true);
    answer(BUSY);
    await vi.waitFor(() => expect(store.getSnapshot().activity).toEqual(BUSY));
    expect(store.getSnapshot().stale).toBe(true);
    store.dispose();
  });

  it("lets only the newest read land", async () => {
    const pending: ((response: Response) => void)[] = [];
    const store = createTaskActivityStore(() => new Promise((resolve) => { pending.push(resolve); }), session);
    store.retry();
    store.retry();
    pending[1]!(new Response(JSON.stringify(BUSY), { status: 200 }));
    await vi.waitFor(() => expect(store.getSnapshot().activity).toEqual(BUSY));
    pending[0]!(new Response(JSON.stringify(WORKING), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getSnapshot().activity).toEqual(BUSY);
    store.dispose();
  });

  it("does not read without a session, nor after dispose", async () => {
    vi.useFakeTimers();
    const request = vi.fn(() => respond(200, WORKING));
    const store = createTaskActivityStore(request, () => undefined, { refreshDelayMs: 10 });
    store.refresh();
    await vi.advanceTimersByTimeAsync(20);
    const later = createTaskActivityStore(request, session, { refreshDelayMs: 10 });
    later.refresh();
    later.dispose();
    await vi.advanceTimersByTimeAsync(20);
    expect(request).not.toHaveBeenCalled();
    store.dispose();
  });
});

it("cancels obsolete task reads and cancels the final read on disposal", async () => {
  const pending: { signal: AbortSignal | null | undefined; finish: (response: Response) => void }[] = [];
  const store = createTaskActivityStore((_path, init) => new Promise<Response>(finish => { pending.push({ signal: init.signal, finish }); }), session);
  store.retry(); store.retry();
  expect(pending[0]?.signal?.aborted).toBe(true);
  pending[1]?.finish(Response.json(BUSY));
  await vi.waitFor(() => expect(store.getSnapshot().activity).toEqual(BUSY));
  pending[0]?.finish(Response.json(WORKING));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(store.getSnapshot().activity).toEqual(BUSY);
  store.retry(); store.dispose();
  expect(pending[2]?.signal?.aborted).toBe(true);
});
