import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionRegistry } from "./sessionRegistry";
import { createOpenServer, openFixture } from "./testing/openFixture";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const session = (id: string) => ({ id, cwd: "/workspace" });
async function fixture() {
  const server = await createOpenServer(url => {
    if (url.pathname.endsWith("/open")) return openFixture({ session: session(url.pathname.split("/").at(-2) ?? "known") });
    return Response.json({ error: "Panel unavailable in fixture" }, { status: 404 });
  }); cleanup.push(server.close);
  const registry = createSessionRegistry(server.transport, { isVisible: () => true, afterPaint: async () => {} }); cleanup.push(registry.dispose);
  return { ...server, registry };
}
describe("six-entry session lifetime", () => {
  it("adopts a prefetched store on selection and holds six idle sockets until a seventh selection", async () => {
    const api = await fixture();
    const prefetched = api.registry.prefetch(session("s1"));
    expect(api.registry.select(session("s1"))).toBe(prefetched);
    for (let index = 2; index <= 6; index++) api.registry.select(session(`s${String(index)}`));
    await vi.waitFor(() => expect(api.registry.getSnapshot().every(record => record.state === "seeded")).toBe(true));
    expect(api.sockets.clients.size).toBe(6);
    expect(api.requests.filter(url => url.pathname.endsWith("/open"))).toHaveLength(6);
    // All initial panel refresh timers have finished: six entries × (open + eight panel reads, including the task list).
    await vi.waitFor(() => expect(api.requests).toHaveLength(54));
    expect(api.registry.select(session("s1"))).toBe(prefetched);
    const requests = api.requests.length;
    await new Promise(resolve => setTimeout(resolve, 20)); expect(api.requests).toHaveLength(requests);
    api.registry.select(session("s7"));
    await vi.waitFor(() => expect(api.registry.getSnapshot().every(record => record.state === "seeded")).toBe(true));
    expect(api.registry.getSnapshot().map(record => record.entry.session.id)).toEqual(["s1", "s3", "s4", "s5", "s6", "s7"]);
    await vi.waitFor(() => expect(api.sockets.clients.size).toBe(6));
  });
  it("disposes every owned adapter exactly once and never evicts the selected entry for speculation", async () => {
    const api = await fixture(); const disposals = vi.fn();
    for (let index = 1; index <= 6; index++) api.registry.select(session(`s${String(index)}`))?.onDispose(disposals);
    expect(api.registry.prefetch(session("extra"))).toBeUndefined();
    expect(disposals).not.toHaveBeenCalled();
    api.registry.dispose(); api.registry.dispose();
    expect(disposals).toHaveBeenCalledTimes(6);
  });
  it("shares the two-request ceiling and cancels unselected speculative reads", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const server = await createOpenServer(async url => { if (!url.pathname.endsWith("/open")) return []; await gate; return openFixture({ session: session(url.pathname.split("/").at(-2) ?? "known") }); }); cleanup.push(server.close);
    const registry = createSessionRegistry(server.transport, { isVisible: () => true, afterPaint: async () => {} }); cleanup.push(registry.dispose);
    registry.prefetch(session("p1")); registry.prefetch(session("p2")); registry.prefetch(session("p3"));
    await vi.waitFor(() => expect(server.requests.filter(url => url.pathname.endsWith("/open"))).toHaveLength(2));
    registry.cancelPrefetch(session("p3"));
    expect(registry.getSnapshot().map(record => record.entry.session.id)).toEqual(["p1", "p2"]);
    registry.select(session("p2")); release();
    await vi.waitFor(() => expect(registry.getSnapshot().every(record => record.state === "seeded")).toBe(true));
    expect(server.requests.filter(url => url.pathname.endsWith("/open"))).toHaveLength(2);
  });
});

it("keeps a deeply paged selected reader intact, then demotes it only when hidden", async () => {
  const messages = Array.from({ length: 300 }, (_, index) => ({ id: `m${String(index)}`, role: index % 2 === 0 ? "user" : "assistant", content: `text ${String(index)}` }));
  const server = await createOpenServer(url => {
    if (url.pathname.endsWith("/open")) return openFixture({ session: session(url.pathname.split("/").at(-2) ?? "known"), page: { messages: messages.slice(250), start: 250, total: 300 } });
    if (url.pathname.endsWith("/messages")) { const before = Number(url.searchParams.get("before")); return { messages: messages.slice(before - 50, before), start: before - 50, total: 300, historyId: "test-history", epoch: "test-daemon", seq: 0 }; }
    return [];
  }); cleanup.push(server.close);
  const registry = createSessionRegistry(server.transport, { isVisible: () => true, afterPaint: async () => {} }); cleanup.push(registry.dispose);
  const entry = registry.select(session("deep")); if (!entry) throw new Error("Missing selected entry");
  await vi.waitFor(() => expect(entry.store.getSnapshot().connection.type).toBe("ready"));
  for (let index = 0; index < 5; index++) await entry.store.loadEarlier();
  expect(entry.store.getSnapshot().transcript.messages).toHaveLength(300);
  expect(registry.getSnapshot().some(record => record.entry === entry)).toBe(true);
  const disposed = vi.fn(); entry.onDispose(disposed);
  registry.select(session("next"));
  expect(disposed).toHaveBeenCalledTimes(1);
  expect(registry.getSnapshot().some(record => record.entry === entry)).toBe(false);
});
