// @vitest-environment happy-dom
import { createServer } from "node:http";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocket as Socket, WebSocketServer } from "ws";
import type { Window as HappyWindow } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ForgerieSession } from "./ForgerieSession";
import { browserTransport } from "./sessionStore";
import type { WorktreeInfo, WorktreeSetup } from "./worktrees/worktreeApi";

let root: Root;
const cleanup: (() => Promise<void>)[] = [];
const until = async (condition: () => boolean) => {
  await act(async () => { await expect.poll(condition, { timeout: 2000 }).toBe(true); });
};
const card = () => document.querySelector(".wt-setup");
const worktree = (phase: WorktreeSetup["phase"]): WorktreeInfo => ({
  id: "wt1", owned: true, repo: "/work", path: "/work/.worktrees/fix-login", branch: "fix-login", defaultBranch: "main",
  state: { kind: "active" }, setup: { phase, log: "" }, cleanup: { kind: "pending" },
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

/** A real session endpoint whose history waits while the catalog's worktree is already known. */
async function openSession(phase: WorktreeSetup["phase"], messages: unknown[] = []) {
  const info = worktree(phase);
  let historyRequested = false;
  let releaseHistory!: () => void;
  const history = new Promise<void>((resolve) => { releaseHistory = resolve; });
  const sockets = new WebSocketServer({ noServer: true });
  const http = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const send = (data: unknown) => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
    if (path.endsWith("/messages")) {
      historyRequested = true;
      await history;
      send({ messages, start: 0, total: messages.length });
    } else if (path.endsWith("/stream-snapshot")) send({ partial: null, seq: 0 });
    else if (path.endsWith("/status")) send({ isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [], worktree: info });
    else if (path.endsWith("/commands")) send([]);
    else if (path.endsWith("/unread")) send({ catalogId: "test", sessions: [] });
    else if (path.endsWith("/projects")) send({ projects: [] });
    else if (path.endsWith("/pull-requests")) send({ links: [], items: [] });
    else { response.writeHead(404); response.end(JSON.stringify({ error: `Unexpected path ${path}` })); }
  });
  http.on("upgrade", (request, socket, head) => sockets.handleUpgrade(request, socket, head, () => {}));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = window as unknown as HappyWindow;
  const previousUrl = window.location.href;
  browser.happyDOM.setURL(origin);
  cleanup.push(async () => { browser.happyDOM.setURL(previousUrl); });
  vi.spyOn(browserTransport, "request").mockImplementation((path, init) => fetch(origin + path, init));
  vi.spyOn(browserTransport, "connect").mockImplementation((path) => new Socket(origin.replace("http:", "ws:") + path) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  cleanup.push(async () => {
    releaseHistory();
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  await act(async () => root.render(<ForgerieSession id="test" known={{ id: "test", cwd: info.path, name: "Fix login" }}
    worktree={info} onSwitchSession={() => {}} />));
  await until(() => historyRequested);
  return { releaseHistory };
}

it("does not flash completed worktree setup while an existing session's history loads", async () => {
  const session = await openSession("done", [{ role: "user", content: "Fix the login form", timestamp: 1 }]);
  expect(document.body.textContent).toContain("Connecting");
  expect(document.querySelector('[aria-label="Loading conversation"]')).not.toBeNull();
  expect(card()).toBeNull();
  await act(async () => session.releaseHistory());
  await until(() => document.body.textContent?.includes("Fix the login form") === true);
  expect(card()).toBeNull();
});

it("shows completed setup for a genuinely empty session only after history loads", async () => {
  const session = await openSession("done");
  expect(card()).toBeNull();
  await act(async () => session.releaseHistory());
  await until(() => card()?.textContent?.includes("Worktree ready") === true);
});

it.each(["creating", "hook", "starting", "failed"] as const)("keeps %s setup visible even before history loads", async (phase) => {
  const session = await openSession(phase);
  expect(card()?.getAttribute("data-phase")).toBe(phase);
  expect(card()?.textContent).toContain(phase === "failed" ? "Worktree setup failed" : "Preparing worktree");
  await act(async () => session.releaseHistory());
  await until(() => document.body.textContent?.includes("Connected") === true);
  expect(card()?.getAttribute("data-phase")).toBe(phase);
});
