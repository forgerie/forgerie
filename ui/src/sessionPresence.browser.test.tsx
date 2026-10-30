// @vitest-environment happy-dom
import { request as httpRequest } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { browserPresence, composerHasFocusedText, createSessionPresence, createBrowserPresenceEnvironment } from "./sessionPresence";
import { createOpenServer, openFixture } from "./testing/openFixture";
import { createSessionStore } from "./sessionStore";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); });
it("uses actual browser input and visibility events and removes its listeners", async () => {
  const arrive = vi.fn(() => Promise.resolve());
  const seen = vi.fn(() => Promise.resolve());
  const presence = createSessionPresence({ environment: browserPresence, arrive, seen, failed: error => { throw error; } });
  cleanups.push(presence.dispose);
  presence.setReady(true); presence.setSelected(true);
  await vi.waitFor(() => expect(arrive).toHaveBeenCalledTimes(1));
  document.dispatchEvent(new Event("wheel"));
  await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange"));
  expect(seen).toHaveBeenCalledTimes(2);
  visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(arrive).toHaveBeenCalledTimes(2));
  presence.dispose(); const sent = seen.mock.calls.length; document.dispatchEvent(new Event("wheel"));
  expect(seen).toHaveBeenCalledTimes(sent);
});
it("does not request an arrival recap when the composer has focus with text", async () => {
  const input = document.createElement("textarea"); input.dataset.composerInput = ""; input.value = "Draft";
  document.body.append(input); input.focus(); expect(composerHasFocusedText()).toBe(true);
  const api = await createOpenServer(url => {
    if (url.pathname.endsWith("/open")) return openFixture();
    if (url.pathname.endsWith("/seen")) return { arrivalId: "12345678-1234-4234-8234-123456789abc" };
    if (url.pathname.endsWith("/commands")) return [];
    if (url.pathname.endsWith("/recap")) return { kind: "skipped" };
    throw new Error(`Unexpected ${url.pathname}`);
  });
  cleanups.push(api.close);
  const transport = { ...api.transport, request: (path: string, init: RequestInit): Promise<Response> => new Promise((resolve, reject) => {
    const request = httpRequest(api.origin + path, { method: init.method ?? "GET", headers: { "content-type": "application/json" } }, response => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      response.on("end", () => { resolve(new Response(Buffer.concat(chunks).toString(), { status: response.statusCode ?? 500 })); });
    });
    request.on("error", reject); request.end(typeof init.body === "string" ? init.body : undefined);
  }) };
  const store = createSessionStore("known", transport, {}, { id: "known", cwd: "/workspace" }); cleanups.push(store.dispose);
  store.setVisible(true); await store.start();
  await vi.waitFor(() => expect(api.requests.some(url => url.pathname.endsWith("/seen"))).toBe(true));
  expect(api.requests.filter(url => url.pathname.endsWith("/recap"))).toHaveLength(0);
  input.value = ""; expect(composerHasFocusedText()).toBe(false);
});

it("remembers the picker input that happened before a session store existed", async () => {
  const environment = createBrowserPresenceEnvironment(); cleanups.push(environment.dispose);
  document.dispatchEvent(new Event("pointerdown"));
  const arrive = vi.fn(() => Promise.resolve());
  const presence = createSessionPresence({ environment, arrive, seen: () => Promise.resolve(), failed: error => { throw error; } });
  cleanups.push(presence.dispose); presence.setSelected(true); presence.setReady(true);
  await vi.waitFor(() => expect(arrive).toHaveBeenCalledExactlyOnceWith(true));
});
