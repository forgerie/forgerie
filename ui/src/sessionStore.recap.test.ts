import { afterEach, expect, it } from "vitest";
import { createOpenServer, openFixture } from "./testing/openFixture";
import { createSessionStore } from "./sessionStore";
import { createReadTracker } from "./readReceipt";
import type { RecapData } from "@shared/sessionRecap";
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const recap: RecapData = { goal: "Ship a fix", done: ["Implemented"], left: ["Not deployed"], next: null, trigger: "manual",
  model: "provider/small", messageCount: 2, coversThroughEntryId: "2", runEndedAt: "2026-01-01T00:00:00.000Z", generatedAt: "2026-01-01T00:10:00.000Z" };
const messages = [{ role: "user", content: "Fix it" }, { role: "assistant", content: [{ type: "text", text: "Implemented, not deployed" }] }];
async function fixture(unread = false, fail = false) {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let written = false;
  const api = await createOpenServer(async url => {
    if (url.pathname.endsWith("/open")) return openFixture({ session: { id: "known", cwd: "/workspace" },
      page: { messages: written ? [...messages, { role: "custom", customType: "forgerie.recap", content: "While you were away", details: recap }] : messages, start: 0, total: written ? 3 : 2 },
      receipt: unread ? { catalogId: "catalog", throughCompletionOrder: 1 } : null });
    if (url.pathname.endsWith("/recap")) { await held; written = !fail; return fail ? { kind: "failed", message: "Could not write a recap. Try /recap again." } : { kind: "written" }; }
    if (url.pathname.endsWith("/unread/acknowledge")) return { catalogId: "catalog", sessions: [] };
    if (url.pathname.endsWith("/commands")) return [];
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  cleanups.push(async () => { release(); await api.close(); });
  const reads = createReadTracker(api.transport, { isVisible: () => true });
  const store = createSessionStore("known", api.transport, {}, { id: "known", cwd: "/workspace" }, reads);
  cleanups.push(store.dispose); store.setVisible(true);
  await store.start();
  return { ...api, store, release };
}
it("intercepts /recap locally, shows progress, and keeps the saved recap as system history", async () => {
  const api = await fixture();
  const writing = api.store.send("/recap");
  await expect.poll(() => api.store.getSnapshot().recap?.kind).toBe("writing");
  await expect.poll(() => api.store.getSnapshot().commands.type).toBe("ready");
  expect(api.store.getSnapshot().commands).toMatchObject({ type: "ready", commands: [{ name: "recap" }] });
  api.release(); await writing;
  await expect.poll(() => api.store.getSnapshot().transcript.messages.some(message => message.recap?.goal === "Ship a fix")).toBe(true);
  expect(api.requests.some(url => url.pathname.endsWith("/commands/run"))).toBe(false);
  expect(api.requests.filter(url => url.pathname.endsWith("/recap"))).toHaveLength(1);
});
it("starts on-open fallback before acknowledging the unread completion", async () => {
  const api = await fixture(true);
  await expect.poll(() => api.store.getSnapshot().recap?.kind).toBe("writing");
  expect(api.requests.some(url => url.pathname.endsWith("/unread/acknowledge"))).toBe(false);
  api.release();
  await expect.poll(() => api.requests.some(url => url.pathname.endsWith("/unread/acknowledge"))).toBe(true);
  expect(api.requests.findIndex(url => url.pathname.endsWith("/recap"))).toBeLessThan(api.requests.findIndex(url => url.pathname.endsWith("/unread/acknowledge")));
});
it("replaces progress with a short manual failure without sending an agent prompt", async () => {
  const api = await fixture(false, true);
  const writing = api.store.send("/recap"); api.release(); await writing;
  expect(api.store.getSnapshot().recap).toEqual({ kind: "failed", message: "Could not write a recap. Try /recap again." });
  expect(api.requests.some(url => /\/(commands\/run|prompt)$/u.test(url.pathname))).toBe(false);
});
