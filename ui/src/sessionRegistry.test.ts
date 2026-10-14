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
