// @vitest-environment happy-dom
import { createServer } from "node:http";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocket as Socket, WebSocketServer } from "ws";
import type { Window as HappyWindow } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ForgerieSession } from "./ForgerieSession";
import { browserTransport } from "./sessionStore";
import type { SessionStatus } from "./contracts";

let root: Root;
const cleanup: (() => Promise<void>)[] = [];
const input = () => document.querySelector<HTMLTextAreaElement>(".composer textarea")!;
const until = async (condition: () => boolean) => {
  await act(async () => { await expect.poll(condition, { timeout: 2000 }).toBe(true); });
};
async function press(key: string, init: KeyboardEventInit = {}) {
  await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Date, "now").mockReturnValue(1_000);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

/** A real local HTTP and socket endpoint, serving an idle Pi session. */
async function session(patch: Partial<SessionStatus> = {}) {
  const commands: unknown[] = [];
  const switches: unknown[] = [];
  const state = { status: { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [], ...patch } as SessionStatus, fail: false, aborts: 0 };
  const ws = new WebSocketServer({ noServer: true });
  const http = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    const send = (data: unknown) => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
    if (path.endsWith("/unread")) send({ catalogId: "test", sessions: [] });
    else if (path.endsWith("/messages")) send({ messages: [], start: 0, total: 0 });
    else if (path.endsWith("/stream-snapshot")) send({ partial: null, seq: 0 });
    else if (path.endsWith("/status")) send(state.status);
    else if (path.endsWith("/pull-request")) send({ link: null, pull: null });
    else if (path.endsWith("/abort")) {
      state.aborts++;
      send({ aborted: true, restoredMessages: state.status.queuedMessages });
    }
    else if (path.endsWith("/commands")) send([]);
    else if (path.endsWith("/commands/run")) {
      commands.push(body);
      if (state.fail) { response.writeHead(503); response.end(JSON.stringify({ error: "Tree read failed" })); }
      else if ((body as { text: string }).text === "/fork") send({ type: "done", session: { id: "fork", cwd: "/work" }, promptDraft: "Fork draft" });
      else send({ type: "tree", tree: { nodes: [{ id: "u1", parentId: null, kind: "user", summary: "First question" }], activeLeafId: "u1", activePathIds: ["u1"] } });
    } else { response.writeHead(404); response.end(JSON.stringify({ error: `Unexpected path ${path}` })); }
  });
  http.on("upgrade", (request, socket, head) => ws.handleUpgrade(request, socket, head, () => {}));
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
    for (const socket of ws.clients) socket.terminate();
    ws.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  await act(async () => root.render(<ForgerieSession id="test" known={{ id: "test", cwd: "/work" }} onSwitchSession={(...args) => { switches.push(args); }} />));
  await until(() => input()?.disabled === false);
  return { commands, switches, state };
}

it("opens the session tree through the command API after two Escapes in an empty message", async () => {
  const api = await session();
  await press("Escape"); expect(api.commands).toEqual([]);
  await press("Escape");
  await until(() => document.querySelector('[role="tree"]') !== null);
  expect(api.commands).toEqual([{ cwd: "/work", text: "/tree" }]);
  expect(document.querySelector('[role="tree"]')?.textContent).toContain("First question");
});

it("honors Pi's fork setting through the command API and switches to the returned session", async () => {
  const api = await session({ doubleEscapeAction: "fork" });
  await press("Escape"); await press("Escape");
  await until(() => api.switches.length === 1);
  expect(api.commands).toEqual([{ cwd: "/work", text: "/fork" }]);
  expect(api.switches).toEqual([[{ id: "fork", cwd: "/work" }, "Fork draft"]]);
});

it("honors none without disabling the visible tree button", async () => {
  const api = await session({ doubleEscapeAction: "none" });
  await press("Escape"); await press("Escape");
  expect(api.commands).toEqual([]);
  const tree = document.querySelector<HTMLButtonElement>('button[aria-label="Session tree"]');
  expect(tree).not.toBeNull();
  await act(async () => tree!.click());
  await until(() => document.querySelector('[role="tree"]') !== null);
  expect(api.commands).toEqual([{ cwd: "/work", text: "/tree" }]);
});

it.each([
  { isCompacting: true },
  { queuedMessages: [{ kind: "followUp" as const, text: "queued draft" }] },
])("Escape uses Stop rather than opening the tree while Pi has work: %j", async (patch) => {
  const api = await session(patch);
  await press("Escape");
  await until(() => api.state.aborts === 1);
  expect(api.commands).toEqual([]);
  if (patch.queuedMessages) await until(() => input().value === "queued draft");
});

it("shows a failed tree read without opening it and permits a later double Escape retry", async () => {
  const api = await session(); api.state.fail = true;
  await press("Escape"); await press("Escape");
  await until(() => document.body.textContent?.includes("Tree read failed") === true);
  expect(document.querySelector('[role="tree"]')).toBeNull();
  api.state.fail = false;
  await press("Escape"); await press("Escape");
  await until(() => document.querySelector('[role="tree"]') !== null);
  expect(api.commands).toHaveLength(2);
});
