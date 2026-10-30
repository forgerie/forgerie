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
import { hereMessage } from "./backlog/suggestions/suggestionsModel";
import { FAILED_ACT, FILING, OPEN, look } from "./backlog/suggestions/fixtures/suggestions";

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
async function chat({ cwd = "/work", projects = { "p-forgerie": "/work" }, records = [record] }: { cwd?: string; projects?: Record<string, string>; records?: Suggestion[] } = {}) {
  const state = { records };
  const posts: { path: string; body: unknown }[] = [];
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  vi.spyOn(browserTransport, "request").mockImplementation(withOpenFixture(async (path, init) => {
    if (init.method === "POST" && !path.endsWith("/seen")) posts.push({ path, body: JSON.parse(String(init.body)) });
    const pressed = /^\/api\/backlog\/suggestions\/([^/]+)\/(file|file-and-act|dismiss|restore)$/u.exec(path);
    if (pressed) {
      const next = answer(state.records.find((entry) => entry.id === pressed[1])!, pressed[2] as "file" | "file-and-act");
      state.records = state.records.map((entry) => entry.id === next.id ? next : entry);
      return Response.json(next);
    }
    if (path.startsWith("/api/backlog/suggestions?")) return Response.json({ suggestions: state.records });
    if (path.endsWith("/prompt")) return Response.json({ accepted: true });
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
  const openBacklogItem = vi.fn();
  const view = () => <ForgerieSession id="test" known={{ id: "test", cwd }} onSwitchSession={switched}
    suggestionLinks={{ look, openSession: opened, openBacklog: vi.fn(), projectPath: (id) => projects[id], openBacklogItem }} />;
  await act(async () => root.render(view()));
  await until(() => ledgeRow() !== null);
  return { state, posts, switched, opened, openBacklogItem, view };
}

const ledgeRow = () => document.querySelector<HTMLElement>("section.ledge[data-open] .ledge-row");
const inLedge = (name: string) => [...ledgeRow()?.querySelectorAll<HTMLButtonElement>("button") ?? []].find((node) => node.textContent === name);
const menuItem = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("[role='menuitem']")].find((node) => node.textContent?.startsWith(name));

describe("a backlog suggestion in the ledge at the input", () => {
  it("summarises it with File and File and act, files from there, and leaves once filed while the thread keeps the card", async () => {
    const { posts } = await chat();
    const row = ledgeRow()!;
    expect(row.querySelector(".ledge-row-kind")?.textContent).toBe("Backlog");
    expect(row.querySelector(".ledge-row-title")?.textContent).toBe(record.title);
    // One proposal has room for a line about it.
    expect(row.querySelector(".ledge-row-gist")?.textContent).toBe(record.body);
    expect(inLedge("File")?.hasAttribute("data-tone")).toBe(false);
    expect(inLedge("File and act")?.getAttribute("data-tone")).toBe("primary");
    expect(inLedge("File and act")?.title).toBe("File it and start a background session on claude-haiku-4-5");
    expect(button("Fold 1 proposal away")?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => inLedge("File and act")!.click());
    expect(posts).toEqual([{ path: `/api/backlog/suggestions/${record.id}/file-and-act`, body: { requestId: expect.any(String) } }]);
    await until(() => ledgeRow() === null);
    expect(button("Fold 1 proposal away")).toBeUndefined();
    expect(document.querySelector("[data-suggestion] .decision-card")).not.toBeNull();
  });

  it("More shows the card in the chat and dismisses", async () => {
    const { posts } = await chat();
    const card = document.querySelector<HTMLElement>(`[data-suggestion="${record.id}"]`)!;
    const scrolled = vi.fn();
    card.scrollIntoView = scrolled;
    await act(async () => button(`More for ${record.title}`)!.click());
    expect([...document.querySelectorAll("[role='menuitem']")].map((item) => item.getAttribute("aria-label") ?? item.textContent))
      .toEqual(["File and act here, This chat works on it next", "File and act on another model…", "Show in chat", "Dismiss"]);
    await act(async () => menuItem("Show in chat")!.click());
    await until(() => scrolled.mock.calls.length === 1);
    // The title is the same press.
    await act(async () => ledgeRow()!.querySelector<HTMLButtonElement>(".ledge-row-main")!.click());
    await until(() => scrolled.mock.calls.length === 2);
    await act(async () => button(`More for ${record.title}`)!.click());
    await act(async () => menuItem("Dismiss")!.click());
    expect(posts.map((post) => post.path)).toEqual([`/api/backlog/suggestions/${record.id}/dismiss`]);
    await until(() => ledgeRow() === null);
  });

  it("File and act here files it, then asks this chat's agent to work on it", async () => {
    const { posts, state } = await chat();
    await act(async () => button(`More for ${record.title}`)!.click());
    await act(async () => menuItem("File and act here")!.click());
    await until(() => posts.length === 2);
    expect(posts[0]).toEqual({ path: `/api/backlog/suggestions/${record.id}/file`, body: { requestId: expect.any(String) } });
    expect(posts[1]?.path).toMatch(/\/prompt$/u);
    expect(posts[1]?.body).toMatchObject({ text: hereMessage(state.records) });
    await until(() => ledgeRow() === null);
  });

  it("the open list's All menu files and acts on every ready suggestion, newest first, one at a time", async () => {
    const newer: Suggestion = { ...record, id: "sg-newer", title: "Show the thinking level in the session picker", createdAt: "2026-10-21T16:50:00Z" };
    const { posts } = await chat({ records: [record, newer] });
    await act(async () => button("Show all 2 proposals")!.click());
    const all = button("Act on all 2 suggestions")!;
    expect(all.querySelector(".menu-button-text-long")?.textContent).toBe("All 2 suggestions");
    await act(async () => all.click());
    expect([...document.querySelectorAll("[role='menuitem']")].map((item) => item.getAttribute("aria-label"))).toEqual([
      "File all 2, Keep them in the backlog for later", "File and act on all 2, Starts 2 sessions on claude-haiku-4-5",
      "File and act on all 2 here, This chat works through them, one at a time", "File and act on all 2 on another model…, One model for all 2 sessions"]);
    // The first item that starts with these words, before the one that ends in "here".
    await act(async () => menuItem("File and act on all 2")!.click());
    await until(() => posts.length === 2);
    expect(posts.map((post) => post.path)).toEqual([`/api/backlog/suggestions/${newer.id}/file-and-act`, `/api/backlog/suggestions/${record.id}/file-and-act`]);
    await until(() => ledgeRow() === null);
  });

  it("says why the last attempt failed, with Retry, and shows filing as work in flight", async () => {
    const { posts } = await chat({ records: [{ ...FAILED_ACT, sessionId: "test" }] });
    expect(ledgeRow()?.querySelector(".ledge-row-kind")?.textContent).toBe("Issue");
    expect(ledgeRow()?.querySelector(".ledge-row-problem")?.textContent).toBe(FAILED_ACT.state.kind === "failed" ? FAILED_ACT.state.message : "");
    expect(inLedge("File and act")).toBeUndefined();
    await act(async () => inLedge("Retry")!.click());
    // Retry repeats what failed: File and act.
    expect(posts.map((post) => post.path)).toEqual([`/api/backlog/suggestions/${FAILED_ACT.id}/file-and-act`]);
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await chat({ records: [{ ...FILING, sessionId: "test" }] });
    expect(ledgeRow()?.querySelector("[role='status']")?.textContent).toBe("Filing…");
    expect(inLedge("File")).toBeUndefined();
  });
});

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
    // The filed file opens in this chat's file reader on a press; nothing opened it before.
    expect(button("Filed to .forgerie/backlog/2026-10-21-retry-on-lost-stream.md")?.tagName).toBe("BUTTON");
  });

  it("in a session worktree, a filed Markdown item opens from the project's main checkout, as the Backlog view shows it", async () => {
    const { openBacklogItem } = await chat({ cwd: "/work/.worktrees/fix-stuck-row" });
    await act(async () => button("File")!.click());
    await until(() => button("Filed to .forgerie/backlog/2026-10-21-retry-on-lost-stream.md") !== undefined);
    expect(openBacklogItem).not.toHaveBeenCalled();
    await act(async () => button("Filed to .forgerie/backlog/2026-10-21-retry-on-lost-stream.md")!.click());
    expect(openBacklogItem).toHaveBeenCalledWith("p-forgerie", ".forgerie/backlog/2026-10-21-retry-on-lost-stream.md");
    // The chat's own file reader, which reaches only the worktree, stays closed.
    expect(button("Close changes")).toBeUndefined();
  });

  it("in the project's main checkout, a filed Markdown item opens in this chat's file reader", async () => {
    const { openBacklogItem } = await chat({ cwd: "/work/" });
    await act(async () => button("File")!.click());
    await until(() => button("Filed to .forgerie/backlog/2026-10-21-retry-on-lost-stream.md") !== undefined);
    await act(async () => button("Filed to .forgerie/backlog/2026-10-21-retry-on-lost-stream.md")!.click());
    await until(() => button("Close changes") !== undefined);
    expect(openBacklogItem).not.toHaveBeenCalled();
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
