// @vitest-environment happy-dom
import { withOpenFixture } from "./testing/openFixture";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocket as Socket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgerieSession } from "./ForgerieSession";
import { browserTransport } from "./sessionStore";
import type { Session, SessionStatus } from "./contracts";
import type { SessionTreeSnapshot } from "./sessionTree";
import type { ComposerInputElement } from "./ui/ComposerEditor";

let root: Root;
let server: WebSocketServer;
let status: SessionStatus;
let history: unknown[];
const posted: { path: string; body: unknown }[] = [];
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const tree: SessionTreeSnapshot = {
  nodes: [
    { id: "u1", parentId: null, kind: "user", summary: "Plan the login fix" },
    { id: "a1", parentId: "u1", kind: "assistant", summary: "Here is a plan" },
  ],
  activeLeafId: "a1", activePathIds: ["u1", "a1"],
};
const input = () => document.querySelector<ComposerInputElement>(".composer [data-composer-input]")!;
const until = async (condition: () => boolean) => {
  await act(async () => { await expect.poll(condition, { timeout: 2000 }).toBe(true); });
};
const click = (node: Element | null | undefined) => act(async () => { (node as HTMLElement).click(); });
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.getAttribute("aria-label") === name || node.textContent?.trim() === name);
const navigator = () => document.querySelector("dialog.tree-dialog");

async function open(onSwitchSession: (session: Session, draft?: string) => void = () => {}) {
  await act(async () => root.render(<ForgerieSession id="a" known={{ id: "a", cwd: "/work" }} onSwitchSession={onSwitchSession} />));
  await until(() => document.querySelector(".status-chip-live")?.textContent === "Connected");
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  status = idle;
  history = [{ role: "user", content: "Plan the login fix", timestamp: 1 }, { role: "assistant", content: [{ type: "text", text: "Here is a plan" }], timestamp: 2 }];
  posted.length = 0;
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  vi.spyOn(browserTransport, "request").mockImplementation(withOpenFixture(async (path, init) => {
    if (path === "/api/sessions/unread") return Response.json({ catalogId: "test", sessions: [] });
    if (path.includes("/messages?")) return Response.json({ messages: history, start: 0, total: history.length });
    if (path.includes("/stream-snapshot?")) return Response.json({ partial: null, seq: 0 });
    if (path.includes("/status?")) return Response.json(status);
    if (path.includes("/commands?")) return Response.json([]);
    posted.push({ path, body: JSON.parse(String(init.body)) });
    if (path.endsWith("/commands/run")) return Response.json({ type: "tree", tree });
    if (path.endsWith("/tree/navigate")) return Response.json({ cancelled: false, editorText: "Plan the login fix" });
    if (path.endsWith("/tree/fork")) return Response.json({ cancelled: false, session: { id: "fork", cwd: "/work", name: "Fork" }, promptDraft: "Plan the login fix" });
    throw new Error(`Unexpected request ${path}`);
  }));
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("session tree in a session", () => {
  it("opens from the header, continues from an entry, and puts its text back in the message box", async () => {
    await open();
    await click(button("Session tree"));
    await until(() => navigator() !== null);
    expect(posted.at(-1)).toEqual({ path: "/api/sessions/a/commands/run", body: { cwd: "/work", text: "/tree" } });
    history = [];
    await click(button("Continue from here"));
    await until(() => navigator() === null);
    expect(posted.at(-1)?.path).toBe("/api/sessions/a/tree/navigate");
    await until(() => input().value === "Plan the login fix");
    await until(() => document.querySelectorAll(".message").length === 0);
  });

  it("opens the fork with the forked message as its draft", async () => {
    const onSwitchSession = vi.fn();
    await open(onSwitchSession);
    await click(button("Session tree"));
    await until(() => navigator() !== null);
    await click(button("Fork"));
    await until(() => onSwitchSession.mock.calls.length === 1);
    expect(onSwitchSession).toHaveBeenCalledWith({ id: "fork", cwd: "/work", name: "Fork" }, "Plan the login fix");
  });

  it("cannot open the tree while the agent works, because Pi refuses it then", async () => {
    status = { ...idle, isStreaming: true };
    await act(async () => root.render(<ForgerieSession id="a" known={{ id: "a", cwd: "/work" }} onSwitchSession={() => {}} />));
    await until(() => document.querySelector(".status-chip-live")?.textContent === "Running");
    expect(button("Session tree")?.disabled).toBe(true);
  });
});
