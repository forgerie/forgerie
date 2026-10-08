// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocket as Socket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { browserTransport } from "./sessionStore";

const idle = { isStreaming: false, isCompacting: false, isBashRunning: false };
const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
let root: Root;
let server: WebSocketServer;
let archived: Set<string>;
let posts: string[];
/** What POST /archive answers for a session: accepted, or a refusal. */
let refuse: (id: string) => string | undefined;
/** Live status of the open sessions. */
let running: Set<string>;
/** When set, POST /archive waits for it. */
let hold: Promise<void> | undefined;

const until = async (condition: () => boolean) => {
  await act(async () => { await expect.poll(condition, { timeout: 3000 }).toBe(true); });
};
const openId = () => new URLSearchParams(window.location.search).get("session");
const archiveButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Archive and next"]');
const connected = () => document.querySelector(".connection-status")?.textContent === "Connected";
const press = (node: HTMLElement | null) => act(async () => { node!.click(); });

/** a is open. c is blocked on you, b is unread, d is just open, w works. */
function listing() {
  const sessions = [
    { id: "a", cwd: "/w", name: "Alpha", modified: at(1) },
    { id: "b", cwd: "/w", name: "Bravo", modified: at(5) },
    { id: "c", cwd: "/w", name: "Charlie", modified: at(60) },
    { id: "d", cwd: "/w", name: "Delta", modified: at(2) },
    { id: "w", cwd: "/w", name: "Working", modified: at(3) },
  ].map((session) => ({ ...session, ...(archived.has(session.id) ? { archived: true } : {}) }));
  return { sessions, statuses: [{ sessionId: "w", ...idle, isStreaming: true }], activities: [] };
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  archived = new Set(); posts = []; running = new Set();
  refuse = () => undefined;
  hold = undefined;
  window.history.replaceState({}, "", "/?session=a");
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  vi.spyOn(browserTransport, "request").mockImplementation(async (path, init) => {
    if (path.endsWith("/unread/acknowledge")) return Response.json({ catalogId: "test", sessions: [] });
    if (init.method === "POST") {
      posts.push(path);
      const id = /\/api\/sessions\/([^/]+)\/(archive|restore)$/u.exec(path);
      if (!id) throw new Error(`Unexpected write ${path}`);
      if (id[2] === "archive") await hold;
      const reason = id[2] === "archive" ? refuse(id[1]!) : undefined;
      if (reason) return Response.json({ error: reason }, { status: 400 });
      if (id[2] === "archive") archived.add(id[1]!); else archived.delete(id[1]!);
      return Response.json({ ok: true });
    }
    if (path === "/api/sessions/all") return Response.json(listing());
    if (path === "/api/sessions/asks") return Response.json({ sessions: [{ id: "c", pendingAsk: { askId: "q" } }] });
    if (path === "/api/sessions/unread") return Response.json({ catalogId: "test", sessions: [{ sessionId: "b", cwd: "/w", completionOrder: 2 }, { sessionId: "a", cwd: "/w", completionOrder: 1 }] });
    if (path === "/api/machines/local/projects") return Response.json([]);
    const session = /^\/api\/sessions\/([^/]+)\//u.exec(path)?.[1];
    if (path.includes("/messages?")) return Response.json({ messages: [], start: 0, total: 0 });
    if (path.includes("/stream-snapshot?")) return Response.json({ partial: null, seq: 0 });
    if (path.includes("/status?")) return Response.json({ ...idle, isStreaming: running.has(session ?? ""), queuedMessages: [] });
    if (path.includes("/commands?")) return Response.json([]);
    return Response.json({ error: `Not in this fixture: ${path}` }, { status: 404 });
  });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function start() {
  await act(async () => root.render(<App />));
  await until(() => connected() && archiveButton()?.disabled === false);
}

describe("archive and next", () => {
  it("walks the sessions that want you, most urgent first, then shows the list", async () => {
    await start();
    await press(archiveButton());
    await until(() => openId() === "c");
    expect(posts).toEqual(["/api/sessions/a/archive"]);
    // The sheet is closed, so the undo offer shows over the thread.
    expect(document.querySelector(".app-toast")?.textContent).toContain("Archived Alpha");

    await until(() => connected() && archiveButton()?.disabled === false);
    await press(archiveButton());
    await until(() => openId() === "b");

    await until(() => connected() && archiveButton()?.disabled === false);
    await press(archiveButton());
    // Nothing else waits: Delta is only open and Working is running. The list opens.
    await until(() => openId() === null);
    expect(document.querySelector(".app-shell")?.getAttribute("data-sheet")).toBe("open");
    expect(posts).toEqual(["/api/sessions/a/archive", "/api/sessions/c/archive", "/api/sessions/b/archive"]);
  });

  it("undoes the archive from the thread", async () => {
    await start();
    await press(archiveButton());
    await until(() => openId() === "c");
    await press(document.querySelector<HTMLButtonElement>(".app-toast .picker-toast-undo"));
    await until(() => posts.includes("/api/sessions/a/restore"));
    expect(archived.has("a")).toBe(false);
  });

  it("stays put and shows the reason when the server refuses", async () => {
    refuse = () => "Stop current session activity before archiving";
    await start();
    await press(archiveButton());
    await until(() => document.querySelector(".app-toast")?.textContent?.includes("Stop current session activity") === true);
    expect(openId()).toBe("a");
  });

  it("archives once for a double press", async () => {
    let release!: () => void;
    hold = new Promise((resolve) => { release = resolve; });
    await start();
    await press(archiveButton());
    await press(archiveButton());
    release();
    await until(() => openId() === "c");
    expect(posts).toEqual(["/api/sessions/a/archive"]);
  });

  it("does not move a reader who opened another session while the archive ran", async () => {
    let release!: () => void;
    hold = new Promise((resolve) => { release = resolve; });
    await start();
    await press(archiveButton());
    await act(async () => {
      window.history.pushState({}, "", "/?session=d");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    release();
    await until(() => archived.has("a"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    expect(openId()).toBe("d");
  });

  it("waits while the open session runs, even before the list hears about it", async () => {
    running.add("a");
    await act(async () => root.render(<App />));
    await until(() => document.querySelector(".connection-status")?.textContent === "Running");
    expect(archiveButton()?.disabled).toBe(true);
    expect(archiveButton()?.title).toBe("Archive and next: Stop the run first");
  });
});
