import { afterEach, expect, it, vi } from "vitest";
import { createOpenServer, openFixture } from "./testing/openFixture";
import { createSessionStore } from "./sessionStore";
import { createReadTracker } from "./readReceipt";
import type { PresenceEnvironment } from "./sessionPresence";
import type { RecapData } from "@shared/sessionRecap";
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const recap: RecapData = { summary: "Ship a fix", trigger: "manual",
  model: "provider/small", messageCount: 2, coversThroughEntryId: "2", runEndedAt: "2026-01-01T00:00:00.000Z", generatedAt: "2026-01-01T00:10:00.000Z" };
const messages = [{ id: "user-1", role: "user", content: "Fix it" }, { id: "answer-1", role: "assistant", content: [{ type: "text", text: "Implemented, not deployed" }] }];
async function fixture(unread = false, fail = false, options: { presence?: PresenceEnvironment; running?: boolean } = {}) {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let recapRequests = 0;
  let written = false;
  let completion = unread;
  let notify: ((id: string) => void) | undefined;
  const api = await createOpenServer(async url => {
    if (url.pathname.endsWith("/open")) return openFixture({ session: { id: "known", cwd: "/workspace" },
      page: { messages: written ? [...messages, { role: "custom", customType: "forgerie.recap", content: "While you were away", details: recap }] : messages, start: 0, total: written ? 3 : 2 },
      status: { isStreaming: options.running ?? false, isCompacting: false, isBashRunning: false },
      receipt: completion ? { catalogId: "catalog", throughCompletionOrder: 1 } : null });
    if (url.pathname.endsWith("/seen")) return { arrivalId: "12345678-1234-4234-8234-123456789abc" };
    if (url.pathname.endsWith("/recap")) { if (++recapRequests === 1 && !unread) return { kind: "skipped" }; await held; written = !fail; return fail ? { kind: "failed", message: "Could not write a recap. Try /recap again." } : { kind: "written" }; }
    if (url.pathname.endsWith("/unread/acknowledge")) return { catalogId: "catalog", sessions: [] };
    if (url.pathname.endsWith("/commands")) return [];
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  cleanups.push(async () => { release(); await api.close(); });
  const sent: { path: string; init: RequestInit }[] = [];
  const transport = { ...api.transport, request: (path: string, init: RequestInit) => { sent.push({ path, init }); return api.transport.request(path, init); } };
  const reads = createReadTracker(transport, { isVisible: () => true, subscribe: listener => { notify = listener; return () => {}; } });
  const store = createSessionStore("known", transport, options, { id: "known", cwd: "/workspace" }, reads);
  cleanups.push(store.dispose); store.setVisible(true);
  await store.start();
  if (!options.running) await expect.poll(() => recapRequests).toBe(1);
  if (!unread && !options.running) await expect.poll(() => store.getSnapshot().recap?.kind).toBe("idle");
  return { ...api, store, release, sent, complete: () => { completion = true; notify?.("known"); } };
}
it("intercepts /recap locally, shows progress, and keeps the saved recap as system history", async () => {
  const api = await fixture();
  const writing = api.store.send("/recap");
  await expect.poll(() => api.store.getSnapshot().recap?.kind).toBe("writing");
  await expect.poll(() => api.store.getSnapshot().commands.type).toBe("ready");
  expect(api.store.getSnapshot().commands).toMatchObject({ type: "ready", commands: [{ name: "recap" }] });
  api.release(); await writing;
  await expect.poll(() => api.store.getSnapshot().transcript.messages.some(message => message.recap !== undefined && "summary" in message.recap && message.recap.summary === "Ship a fix")).toBe(true);
  expect(api.requests.some(url => url.pathname.endsWith("/commands/run"))).toBe(false);
  expect(api.requests.filter(url => url.pathname.endsWith("/recap"))).toHaveLength(2);
});
it("acknowledges an arrival without waiting for the recap request", async () => {
  const api = await fixture(true);
  await expect.poll(() => api.store.getSnapshot().recap?.kind).toBe("writing");
  await expect.poll(() => api.requests.some(url => url.pathname.endsWith("/unread/acknowledge"))).toBe(true);
});
it("does not request a recap for an unread completion in the visible session", async () => {
  const api = await fixture();
  api.complete();
  await expect.poll(() => api.requests.filter(url => url.pathname.endsWith("/open")).length).toBe(2);
  expect(api.requests.filter(url => url.pathname.endsWith("/recap"))).toHaveLength(1);
});
it("replaces progress with a short manual failure without sending an agent prompt", async () => {
  const api = await fixture(false, true);
  const writing = api.store.send("/recap"); api.release(); await writing;
  expect(api.store.getSnapshot().recap).toEqual({ kind: "failed", message: "Could not write a recap. Try /recap again." });
  expect(api.requests.some(url => /\/(commands\/run|prompt)$/u.test(url.pathname))).toBe(false);
});

it("requests an arrival recap on reselection and document return, not repeated selection", async () => {
  let visible = true;
  const events = new Map<string, () => void>();
  const environment: PresenceEnvironment = { now: () => 0, visible: () => visible,
    listen: (type, listener) => { events.set(type, listener); return () => { events.delete(type); }; }, repeat: () => () => {} };
  const api = await fixture(false, false, { presence: environment });
  api.release();
  api.store.setVisible(false); api.store.setVisible(true);
  await expect.poll(() => api.requests.filter(url => url.pathname.endsWith("/recap")).length).toBe(2);
  await expect.poll(() => api.store.getSnapshot().recap?.kind).toBe("idle");
  api.store.setVisible(true);
  visible = false; events.get("visibilitychange")?.();
  visible = true; events.get("visibilitychange")?.();
  await expect.poll(() => api.requests.filter(url => url.pathname.endsWith("/recap")).length).toBe(3);
});
it("records arrival without requesting a recap when the session is running, and does not retry on run end", async () => {
  const api = await fixture(false, false, { running: true });
  await expect.poll(() => api.requests.some(url => url.pathname.endsWith("/seen"))).toBe(true);
  api.emit({ type: "agent.end", seq: 1 });
  await vi.waitFor(() => expect(api.store.getSnapshot().transcript.isRunning).toBe(false));
  expect(api.requests.filter(url => url.pathname.endsWith("/recap"))).toHaveLength(0);
});

it("sends only server-independent seen markers and a keepalive departure, even for a running session", async () => {
  const events = new Map<string, () => void>();
  const environment: PresenceEnvironment = { now: () => 0, visible: () => true,
    listen: (type, listener) => { events.set(type, listener); return () => { events.delete(type); }; }, repeat: () => () => {} };
  const api = await fixture(false, false, { presence: environment, running: true });
  await expect.poll(() => api.requests.filter(url => url.pathname.endsWith("/seen")).length).toBe(1);
  events.get("pointerdown")?.();
  await expect.poll(() => api.requests.filter(url => url.pathname.endsWith("/seen")).length).toBe(2);
  const heartbeat = api.sent.filter(request => request.path.endsWith("/seen")).at(-1);
  expect(JSON.parse(String(heartbeat?.init.body))).toEqual({ cwd: "/workspace", seenThrough: "answer-1" });
  api.store.setVisible(false);
  expect(api.sent.filter(request => request.path.endsWith("/seen")).at(-1)?.init.keepalive).toBe(true);
  expect(api.requests.filter(url => url.pathname.endsWith("/recap"))).toHaveLength(0);
});
