// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocketServer, WebSocket as Socket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgerieSession } from "./ForgerieSession";
import { browserTransport } from "./sessionStore";
import { withOpenFixture } from "./testing/openFixture";
import type { SessionStatus } from "./contracts";
import { EMPTY, IDLE_BACKGROUND } from "./session/fixtures/taskActivity";

let root: Root;
let server: WebSocketServer | undefined;
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const until = async (condition: () => boolean) => {
  await act(async () => { await expect.poll(condition, { timeout: 3000 }).toBe(true); });
};
const chip = () => document.querySelector<HTMLButtonElement>("button.status-chip-face");
const panel = () => document.querySelector(".status-chip-panel");
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === label);
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

/** An idle Durable session. Its tasks route answers from `state`, which a test changes as the server would. */
async function idleSession(tasks: { status: number; body: unknown }) {
  const state = { tasks, reads: 0 };
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  vi.spyOn(browserTransport, "request").mockImplementation(withOpenFixture(async (path) => {
    if (path === "/api/sessions/unread") return Response.json({ catalogId: "test", sessions: [] });
    if (path.startsWith("/api/sessions/test/tasks?")) { state.reads += 1; return Response.json(state.tasks.body, { status: state.tasks.status }); }
    if (path.includes("/gated-actions?") || path.includes("/decisions?") || path.includes("/children?")) return Response.json([]);
    if (path.includes("/workflow-proposals?") || path.includes("/workflow-runs?")) return Response.json([]);
    if (path.includes("/messages?")) return Response.json({ messages: [], start: 0, total: 0 });
    if (path.includes("/stream-snapshot?")) return Response.json({ partial: null, seq: 0 });
    if (path.includes("/status?")) return Response.json(idle);
    if (path.includes("/commands?")) return Response.json([]);
    return Response.json({ error: "Not found" }, { status: 404 });
  }));
  await act(async () => root.render(<ForgerieSession id="test" known={{ id: "test", cwd: "/work" }} onSwitchSession={() => {}} />));
  return state;
}

describe("the session's tasks in the status chip", () => {
  it("opens the panel of an idle session when the task read fails, keeps the word, and closes it once Try again succeeds", async () => {
    const api = await idleSession({ status: 500, body: { error: "Durable storage is unavailable." } });
    await until(() => chip() !== null);
    expect(chip()?.getAttribute("aria-label")).toBe("Connected. Show details");
    await act(async () => { chip()!.click(); });
    expect(panel()?.querySelector(".alert-card")?.textContent).toContain("Durable storage is unavailable.");
    expect(panel()?.querySelector(".status-chip-title")?.textContent).toBe("Connected");
    api.tasks = { status: 200, body: EMPTY };
    await act(async () => { button("Try again")!.click(); });
    // Idle, nothing live, and read: nothing left to show, so the panel closes and the chip goes quiet.
    await until(() => panel() === null && chip() === null);
    expect(document.querySelector(".status-chip-live")?.textContent).toBe("Connected");
  });

  it("opens the panel again when a list that was empty fails to refresh", async () => {
    const api = await idleSession({ status: 200, body: EMPTY });
    await until(() => api.reads > 0);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(chip()).toBeNull();
    api.tasks = { status: 500, body: { error: "Durable storage is unavailable." } };
    for (const socket of server!.clients) socket.send(JSON.stringify({ type: "pi.event", eventType: "durable_children_changed" }));
    await until(() => chip() !== null);
    await act(async () => { chip()!.click(); });
    expect(panel()?.textContent).toContain("Could not read tasks");
    expect(panel()?.textContent).toContain("Nothing runs in the background.");
    expect(button("Try again")).toBeDefined();
  });

  it("carries background agents as the chip's aside while the session is idle", async () => {
    await idleSession({ status: 200, body: IDLE_BACKGROUND });
    await until(() => document.querySelector(".status-chip-aside") !== null);
    expect(document.querySelector(".status-chip-aside")?.textContent).toBe("2 agents");
    expect(chip()?.getAttribute("aria-label")).toBe("Connected, 2 background agents. Show details");
  });
});
