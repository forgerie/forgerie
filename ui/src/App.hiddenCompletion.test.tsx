// @vitest-environment happy-dom
import { act, useEffect, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Window as HappyWindow } from "happy-dom";
import { useAui, useAuiState, type AssistantClient } from "@assistant-ui/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { browserTransport } from "./sessionStore";
import type { UiEvent } from "./contracts";
import { createOpenServer, openFixture } from "./testing/openFixture";

let root: Root | undefined;
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  await close?.();
  document.body.replaceChildren(); window.localStorage.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("commits a hidden completion's final text without first committing its partial text on return", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState({}, "", "/?session=a");
  const sessions = ["a", "b"].map(id => ({ id, cwd: "/workspace", name: id, modified: "2026-10-14T12:00:00Z" }));
  const idle = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
  const partial = { role: "assistant", content: [{ type: "text", text: "Partial reply" }], timestamp: 123 };
  const api = await createOpenServer(url => {
    if (url.pathname === "/api/sessions/all") return { sessions, statuses: [], activities: [] };
    if (url.pathname === "/api/sessions/asks") return { sessions: [] };
    if (url.pathname === "/api/sessions/unread") return { catalogId: "test", sessions: [] };
    if (url.pathname === "/api/machines/local/projects") return [];
    if (url.pathname.endsWith("/commands")) return [];
    if (url.pathname.endsWith("/open")) {
      const session = sessions.find(session => url.pathname.includes(`/sessions/${session.id}/`))!;
      return openFixture({ session, status: { ...idle, isStreaming: session.id === "a" },
        snapshot: { seq: 0, partial: session.id === "a" ? partial : null } });
    }
    return Response.json({ error: "Panel unavailable in fixture" }, { status: 404 });
  });
  close = api.close;
  (window as unknown as HappyWindow).happyDOM.setURL(`${api.origin}/?session=a`);
  vi.spyOn(browserTransport, "request").mockImplementation(api.transport.request);
  let completionDelivered = false;
  vi.spyOn(browserTransport, "connect").mockImplementation(path => {
    const socket = api.transport.connect(path);
    if (path.includes("/sessions/a/")) socket.addEventListener("message", event => {
      if (typeof event.data === "string" && JSON.parse(event.data).seq === 3) completionDelivered = true;
    });
    return socket;
  });
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  const liveSockets = new Set<import("ws").WebSocket>();
  api.sockets.on("connection", (socket, request) => {
    if (request.url?.startsWith("/api/sessions/a/events?")) liveSockets.add(socket);
  });
  const emit = (event: UiEvent) => {
    for (const socket of liveSockets) socket.send(JSON.stringify(event));
  };
  const runtimes = new Map<string, AssistantClient>();
  let retained: Element | null = null;
  const completionCommits: string[] = [];
  // The related-work extension consumes the same public runtime as the thread.
  function RuntimeReader({ id }: { id: string }) {
    const runtime = useAui();
    const last = useAuiState(state => state.thread.messages.at(-1));
    useEffect(() => { runtimes.set(id, runtime); }, [id, runtime]);
    // Read the DOM after the commit that publishes the completed reply, before
    // passive effects or a deferred Markdown pass can repair that commit.
    useLayoutEffect(() => {
      if (id === "a" && last?.status?.type === "complete") completionCommits.push(retained?.querySelector(".message-text")?.textContent ?? "");
    }, [id, last]);
    return null;
  }
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const until = async (check: () => boolean) => {
    await act(async () => { await expect.poll(check, { timeout: 3000 }).toBe(true); });
  };
  await act(async () => root!.render(<App relatedWork={({ ref }) => <RuntimeReader id={ref.id} />} />));
  await until(() => document.querySelector(".message-text")?.textContent === "Partial reply");
  retained = document.querySelector(".transcript");
  await act(async () => { document.getElementById("picker-row-b")!.click(); });
  await until(() => runtimes.get("b")?.thread.getState().isLoading === false);
  expect(retained?.closest('[style*="display: none"]')).not.toBeNull();
  const final = { ...partial, content: [{ type: "text", text: "Final reply completed while hidden." }] };
  await act(async () => {
    emit({ type: "message.end", message: final, seq: 1 });
    emit({ type: "agent.end", seq: 2 });
    emit({ type: "status.update", status: idle, seq: 3 });
  });
  await until(() => completionDelivered);
  expect(completionCommits).toEqual([]);
  const transcriptReads = () => api.requests.filter(url => /\/(open|messages|status|stream-snapshot)$/u.test(url.pathname));
  const requests = transcriptReads().length;
  await act(async () => { document.getElementById("picker-row-a")!.click(); });
  expect(completionCommits[0]).toBe("Final reply completed while hidden.");
  expect(document.querySelector(".transcript")).toBe(retained);
  expect(retained?.textContent?.split("Final reply completed while hidden.")).toHaveLength(2);
  expect(transcriptReads()).toHaveLength(requests);
});
