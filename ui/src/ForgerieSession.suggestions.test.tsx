// @vitest-environment happy-dom
// A chat whose agent suggested a backlog item: the card in the thread reads the server's record, File and act
// never moves the reader, the header counts the chat's suggestions, and a reload shows the last outcome.
import { withOpenFixture } from "./testing/openFixture";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocketServer, WebSocket as Socket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgerieSession } from "./ForgerieSession";
import { browserTransport } from "./sessionStore";
import type { PiMessage, SessionStatus } from "./contracts";
import type { Suggestion } from "./backlog/suggestions/suggestionsApi";
import { answer } from "./backlog/suggestions/fixtures/serverLike";
import { OPEN, look } from "./backlog/suggestions/fixtures/suggestions";

let root: Root;
let server: WebSocketServer | undefined;
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent?.trim() === name || node.getAttribute("aria-label") === name);
const until = async (condition: () => boolean) => {
  await act(async () => { await expect.poll(condition, { timeout: 2000 }).toBe(true); });
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  if (server) {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const record: Suggestion = { ...OPEN, sessionId: "test" };
const messages: PiMessage[] = [
  { role: "user", content: "After my connection dropped, the tool row stayed on running. Fix it." },
  { role: "assistant", content: [{ type: "text", text: "Fixed. The retry is a separate change, so I suggested it." },
    { type: "toolCall", id: "s1", name: "suggest_backlog", arguments: { title: record.title } }] },
  { role: "toolResult", toolCallId: "s1", toolName: "suggest_backlog", content: [{ type: "text", text: "Suggested." }],
    details: { suggestionId: record.id, destination: record.destination } } as unknown as PiMessage,
];

/** One chat on the routes, which answer from `state` as the server would. */
async function chat() {
  const state = { records: [record] };
  const posts: { path: string; body: unknown }[] = [];
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  vi.spyOn(browserTransport, "request").mockImplementation(withOpenFixture(async (path, init) => {
    if (init.method === "POST") posts.push({ path, body: JSON.parse(String(init.body)) });
    const pressed = /^\/api\/backlog\/suggestions\/([^/]+)\/(file|file-and-act|dismiss|restore)$/u.exec(path);
    if (pressed) {
      const next = answer(state.records.find((entry) => entry.id === pressed[1])!, pressed[2] as "file" | "file-and-act");
      state.records = state.records.map((entry) => entry.id === next.id ? next : entry);
      return Response.json(next);
    }
    if (path.startsWith("/api/backlog/suggestions?")) return Response.json({ suggestions: state.records });
    if (path === "/api/sessions/unread") return Response.json({ catalogId: "test", sessions: [] });
    if (path.includes("/decisions?") || path.includes("/children?") || path.includes("/workflow-proposals?") || path.includes("/workflow-runs?")) return Response.json([]);
    if (path.includes("/messages?")) return Response.json({ messages, start: 0, total: messages.length });
    if (path.includes("/stream-snapshot?")) return Response.json({ partial: null, seq: 0 });
    if (path.includes("/status?")) return Response.json(idle);
    if (path.includes("/commands?")) return Response.json([]);
    return Response.json({ error: "Not found" }, { status: 404 });
  }));
  const switched = vi.fn();
  const opened = vi.fn();
  const view = () => <ForgerieSession id="test" known={{ id: "test", cwd: "/work" }} onSwitchSession={switched}
    suggestionLinks={{ look, openSession: opened, openBacklog: vi.fn() }} />;
  await act(async () => root.render(view()));
  await until(() => button("File and act") !== undefined);
  return { state, posts, switched, opened, view };
}

describe("a backlog suggestion in the chat", () => {
  it("draws the server's record as a card, and counts it in the header", async () => {
    await chat();
    expect(document.body.textContent).toContain("Retry once when the provider stream drops before message.end");
    expect(document.body.textContent).toContain("Goes to .forgerie/backlog/2026-10-21-retry-on-lost-stream.md");
    expect(button("Backlog suggestions, 1 open")).toBeDefined();
    // The card stands in the reply; it is not folded into the tool activity.
    expect(document.querySelector("[data-suggestion] .decision-card")).not.toBeNull();
  });

  it("File and act files the item and starts a background session, and the reader stays in this chat", async () => {
    const before = window.location.href;
    const push = vi.spyOn(window.history, "pushState");
    const { posts, switched, opened } = await chat();
    await act(async () => button("File and act")!.click());
    await until(() => document.body.textContent?.includes("Working") === true);
    expect(posts).toEqual([{ path: `/api/backlog/suggestions/${record.id}/file-and-act`, body: { requestId: expect.any(String) } }]);
    expect(switched).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(window.location.href).toBe(before);
    // The header now says a background session works on it.
    expect(button("Backlog suggestions, 0 open, 1 in background working")).toBeDefined();
    // Only Open moves the reader, and to the background session.
    await act(async () => button("Open the background session, Retry once when the provider stream drops")!.click());
    expect(opened).toHaveBeenCalledWith("s-bg-working");
    expect(switched).not.toHaveBeenCalled();
  });

  it("after a reload, the card shows the last outcome from the server", async () => {
    const { view } = await chat();
    await act(async () => button("File")!.click());
    await until(() => document.body.textContent?.includes("Filed to") === true);
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root.render(view()));
    await until(() => document.body.textContent?.includes("Filed to .forgerie/backlog/2026-10-21-retry-on-lost-stream.md") === true);
    expect(button("File")).toBeUndefined();
    expect(button("File and act")).toBeUndefined();
  });

  it("the header's list files from a row and shows a row in the chat", async () => {
    const { posts } = await chat();
    await act(async () => button("Backlog suggestions, 1 open")!.click());
    const sheet = document.querySelector("dialog")!;
    expect(sheet.textContent).toContain("1 open");
    const file = [...sheet.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "File")!;
    await act(async () => file.click());
    await until(() => document.querySelector("dialog")?.textContent?.includes("1 filed") === true);
    expect(posts.map((post) => post.path)).toEqual([`/api/backlog/suggestions/${record.id}/file`]);
  });
});
