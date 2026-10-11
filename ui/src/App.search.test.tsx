// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocket as Socket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { browserTransport } from "./sessionStore";
import { createSearchApi, type SearchHit } from "./search/searchApi";
import { useSessionSearch } from "./search/useSessionSearch";
import type { SessionTreeSnapshot } from "./sessionTree";

const idle = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
let root: Root;
let server: WebSocketServer;
let searches: URL[];
let posted: string[];
/** The shell's measured width: under 1000 px the list is a sheet, from 1000 it docks. */
let shellWidth: number;
let observers: (() => void)[];

const hit = (sessionId: string, title: string, entryId: string, text: string, extra: Partial<SearchHit> = {}): SearchHit => ({
  sessionId, cwd: "/w", title, modified: at(30), archived: false, offBranch: false, otherMatches: 0,
  passage: { entryId, role: "assistant", text, marks: [[text.indexOf("deploy"), text.indexOf("deploy") + 6]] }, ...extra,
});
const HITS = [
  hit("b", "Bravo", "b-2", "The deploy now retries once.", { otherMatches: 2 }),
  hit("c", "Charlie", "c-off", "A warm store makes the deploy fast.", { offBranch: true }),
];
const histories: Record<string, unknown[]> = {
  a: [{ role: "user", content: "Hello", timestamp: 1 }],
  b: [
    { role: "user", content: "Make the deploy retry", timestamp: 1 },
    { role: "assistant", content: [{ type: "text", text: "Sure." }], timestamp: 2 },
    { role: "user", content: "And the deploy log?", timestamp: 3 },
    { role: "assistant", content: [{ type: "text", text: "The deploy now retries once." }], timestamp: 4 },
  ],
  c: [{ role: "user", content: "Cache the store", timestamp: 1 }],
};
const tree: SessionTreeSnapshot = {
  nodes: [
    { id: "c-1", parentId: null, kind: "user", summary: "Cache the store" },
    { id: "c-off", parentId: "c-1", kind: "assistant", summary: "A warm store makes the deploy fast." },
  ],
  activeLeafId: "c-1", activePathIds: ["c-1"],
};

const until = async (condition: () => boolean) => {
  await act(async () => { await expect.poll(condition, { timeout: 3000 }).toBe(true); });
};
const openId = () => new URLSearchParams(window.location.search).get("session");
const box = () => document.querySelector<HTMLInputElement>('input[aria-label="Search sessions"]')!;
const sheet = () => document.querySelector(".app-shell")?.getAttribute("data-sheet");
const titles = () => [...document.querySelectorAll(".picker-row .picker-title")].map((node) => node.textContent);
const hitTitles = () => [...document.querySelectorAll(".hit-row-title")].map((node) => node.textContent);
const key = (target: EventTarget, init: KeyboardEventInit) => act(async () => {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
});
const type = (text: string) => act(async () => {
  const input = box();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const resize = (width: number) => act(async () => { shellWidth = width; for (const observer of observers) observer(); });
const searchApi = createSearchApi((path, init) => browserTransport.request(path, init));

function Searching() {
  const search = useSessionSearch(searchApi, undefined);
  return <App search={search} />;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  searches = []; posted = []; observers = []; shellWidth = 600;
  vi.stubGlobal("ResizeObserver", class { constructor(private readonly callback: () => void) { observers.push(() => this.callback()); } observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: shellWidth, height: 600, x: 0, y: 0, top: 0, left: 0, right: shellWidth, bottom: 600, toJSON: () => ({}) }));
  Element.prototype.scrollTo = vi.fn() as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  window.history.replaceState({}, "", "/?session=a");
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  vi.spyOn(browserTransport, "request").mockImplementation(async (path, init) => {
    const url = new URL(path, "http://forgerie.test");
    if (url.pathname === "/api/sessions/search") {
      searches.push(url);
      return Response.json({ hits: HITS, index: { state: "ready", indexedFiles: 4, totalFiles: 4 } });
    }
    if (url.pathname === "/api/sessions/c/search-matches") return Response.json({ matches: [{ entryId: "c-off", role: "assistant", offBranch: true }] });
    if (url.pathname === "/api/sessions/b/search-matches") return Response.json({ matches: [
      { entryId: "b-0", role: "user", offBranch: false, position: 0 },
      { entryId: "b-2", role: "user", offBranch: false, position: 2 },
      { entryId: "b-3", role: "assistant", offBranch: false, position: 3 },
    ] });
    if (path.endsWith("/unread/acknowledge")) return Response.json({ catalogId: "test", sessions: [] });
    if (init.method === "POST") {
      posted.push(path);
      if (path.endsWith("/commands/run")) return Response.json({ type: "tree", tree });
      return Response.json({ ok: true });
    }
    if (path === "/api/sessions/all") return Response.json({ statuses: [], activities: [], sessions: [
      { id: "a", cwd: "/w", name: "Alpha", modified: at(1) },
      { id: "b", cwd: "/w", name: "Bravo", modified: at(5) },
      { id: "c", cwd: "/w", name: "Charlie", modified: at(9) },
      { id: "z", cwd: "/w", name: "Alder, put away", modified: at(900), archived: true },
    ] });
    if (path === "/api/sessions/asks") return Response.json({ sessions: [] });
    if (path === "/api/sessions/unread") return Response.json({ catalogId: "test", sessions: [] });
    if (path === "/api/machines/local/projects") return Response.json([]);
    const session = /^\/api\/sessions\/([^/]+)\//u.exec(path)?.[1] ?? "";
    if (path.includes("/messages?")) return Response.json({ messages: histories[session] ?? [], start: 0, total: histories[session]?.length ?? 0 });
    if (path.includes("/stream-snapshot?")) return Response.json({ partial: null, seq: 0 });
    if (path.includes("/status?")) return Response.json(idle);
    if (path.includes("/commands?")) return Response.json([]);
    return Response.json({ error: `Not in this fixture: ${path}` }, { status: 404 });
  });
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Searching />));
  await until(() => titles().includes("Alpha"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("reaching the search box", () => {
  it("Ctrl+K opens the closed list and focuses the box, even from the message box", async () => {
    expect(sheet()).toBe("closed");
    const composer = await (async () => { await until(() => document.querySelector("[data-composer-input]") !== null); return document.querySelector<HTMLElement>("[data-composer-input]")!; })();
    composer.focus();
    await key(composer, { key: "k", ctrlKey: true });
    expect(sheet()).toBe("open");
    await until(() => document.activeElement === box());
  });

  it("/ focuses the box when no text field has focus, and types a slash in one", async () => {
    await key(document.body, { key: "/" });
    expect(sheet()).toBe("open");
    await until(() => document.activeElement === box());
    box().blur();
    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    const composer = document.querySelector<HTMLElement>("[data-composer-input]")!;
    composer.focus();
    await act(async () => { composer.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(box());
  });
});

describe("searching the list", () => {
  it("filters by title under three characters, archived sessions included, and says how to search messages", async () => {
    await type("al");
    expect(titles()).toEqual(["Alpha", "Alder, put away"]);
    expect(document.body.textContent).toContain("Type 3 or more characters to search messages");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(searches).toEqual([]);
    await type("zq");
    expect(document.body.textContent).toContain("No session titles match “zq”");
  });

  it("replaces the list with hits from three characters, and Escape clears both", async () => {
    await type("deploy");
    await until(() => hitTitles().length === 2);
    expect(searches).toHaveLength(1);
    expect(searches[0]!.searchParams.get("q")).toBe("deploy");
    expect(searches[0]!.searchParams.getAll("scope")).toEqual([]);
    expect(titles()).toEqual([]);
    expect(document.querySelector(".hit-row-mark")?.textContent).toBe("deploy");
    expect(document.body.textContent).toContain("Other branch");
    expect(document.body.textContent).toContain("+2 more matches");
    await key(box(), { key: "Escape" });
    expect(box().value).toBe("");
    expect(hitTitles()).toEqual([]);
    expect(titles()).toContain("Alpha");
  });

  it("clears the query on Escape from the hits, and closes the list only on a second Escape", async () => {
    await key(document.body, { key: "k", ctrlKey: true });
    await until(() => document.activeElement === box());
    await type("deploy");
    await until(() => hitTitles().length === 2);
    await key(box(), { key: "ArrowDown" });
    const first = document.querySelector<HTMLButtonElement>(".hit-row")!;
    expect(document.activeElement).toBe(first);
    await key(first, { key: "Escape" });
    expect(box().value).toBe("");
    expect(hitTitles()).toEqual([]);
    expect(sheet()).toBe("open");
    expect(document.activeElement).toBe(box());
    await key(box(), { key: "Escape" });
    expect(sheet()).toBe("closed");
  });

  it("keeps the query and its hits across the switch to a docked list and back", async () => {
    await type("deploy");
    await until(() => hitTitles().length === 2);
    await resize(1200);
    expect(document.querySelector(".app-shell")?.getAttribute("data-layout")).toBe("docked");
    expect(box().value).toBe("deploy");
    expect(hitTitles()).toEqual(["Bravo", "Charlie"]);
    await resize(475);
    expect(document.querySelector(".app-shell")?.getAttribute("data-layout")).toBe("overlay");
    expect(box().value).toBe("deploy");
    expect(hitTitles()).toEqual(["Bravo", "Charlie"]);
    expect(searches).toHaveLength(1);
  });
});

describe("opening a hit", () => {
  it("opens an on-branch hit at its match, and the hits wait for the next look", async () => {
    await type("deploy");
    await until(() => hitTitles().length === 2);
    await act(async () => { document.querySelector<HTMLButtonElement>(".hit-row")!.click(); });
    await until(() => openId() === "b");
    expect(sheet()).toBe("closed");
    await until(() => document.querySelector('[aria-label="Search matches"]')?.textContent?.includes("Match 2 of 3") === true);
    await until(() => document.querySelector(".message[data-marked]")?.textContent?.includes("And the deploy log?") === true);
    await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="Next match"]')!.click(); });
    await until(() => document.querySelector(".message[data-marked]")?.textContent?.includes("The deploy now retries once.") === true);
    // Back in the list, the query and its hits are still there.
    expect(box().value).toBe("deploy");
    expect(hitTitles()).toEqual(["Bravo", "Charlie"]);
  });

  it("opens an off-branch hit in the history tree, on its entry", async () => {
    await type("deploy");
    await until(() => hitTitles().length === 2);
    await act(async () => { document.querySelectorAll<HTMLButtonElement>(".hit-row")[1]!.click(); });
    await until(() => openId() === "c");
    await until(() => document.querySelector("dialog.tree-dialog") !== null);
    expect(posted).toContain("/api/sessions/c/commands/run");
    expect(document.querySelector('dialog.tree-dialog [role="treeitem"][aria-selected="true"]')?.textContent).toContain("A warm store makes the deploy fast.");
  });
});
