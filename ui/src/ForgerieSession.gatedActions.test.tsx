// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocketServer, WebSocket as Socket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgerieSession } from "./ForgerieSession";
import { browserTransport } from "./sessionStore";
import type { PiMessage, SessionStatus } from "./contracts";
import type { GatedAction } from "./gatedActions/gatedActionsModel";
import { PUSH, PUSH_ENTRY, PUSH_RAN, PUSH_RUNNING } from "./gatedActions/fixtures/gatedActions";

let root: Root;
let server: WebSocketServer | undefined;
const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const dockButton = (name: string) => [...document.querySelectorAll<HTMLButtonElement>(".pinned-dock button")].find((node) => node.textContent === name);
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

const messages: PiMessage[] = [
  { role: "user", content: "Rebase the export branch and push it." },
  { role: "assistant", content: [{ type: "text", text: "The branch is rebased. The push needs your approval." }] },
  // As the session file holds it: the entry's fields, with the file's own bookkeeping stamped in.
  { role: "custom", customType: "forgerie.gated-action", content: `Gated action: ${JSON.stringify(PUSH_ENTRY)}`,
    details: { ...PUSH_ENTRY, durableSessionId: "test", durableEntryId: 12, durableJournalId: "j-1", durableConversationId: 1, durableMessageIndex: 0 } },
];

/** A Durable session with a blocked call. The routes answer from `state`, which a test changes as the server would. */
async function sessionWithGate(status: SessionStatus, options: { records?: GatedAction[]; refusal?: string; readFails?: boolean } = {}) {
  const state = { records: options.records ?? [PUSH], refusal: options.refusal, readFails: options.readFails ?? false };
  const posts: { path: string; body: unknown }[] = [];
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  vi.spyOn(browserTransport, "request").mockImplementation(async (path, init) => {
    if (init.method === "POST") posts.push({ path, body: JSON.parse(String(init.body)) });
    if (path === "/api/sessions/unread") return Response.json({ catalogId: "test", sessions: [] });
    if (path.endsWith(`/gated-actions/${encodeURIComponent(PUSH.id)}/approve`)) {
      if (state.refusal !== undefined) return Response.json({ error: state.refusal }, { status: 409 });
      state.records = [PUSH_RUNNING];
      return Response.json(PUSH_RUNNING);
    }
    if (path.includes("/gated-actions?")) return state.readFails ? Response.json({ error: "Durable storage is unavailable." }, { status: 500 }) : Response.json(state.records);
    if (path.includes("/decisions?") || path.includes("/children?")) return Response.json([]);
    if (path.includes("/workflow-proposals?") || path.includes("/workflow-runs?")) return Response.json([]);
    if (path.includes("/messages?")) return Response.json({ messages, start: 0, total: messages.length });
    if (path.includes("/stream-snapshot?")) return Response.json({ partial: null, seq: 0 });
    if (path.includes("/status?")) return Response.json(status);
    if (path.includes("/commands?")) return Response.json([]);
    return Response.json({ error: "Not found" }, { status: 404 });
  });
  await act(async () => root.render(<ForgerieSession id="test" known={{ id: "test", cwd: "/work" }} onSwitchSession={() => {}} />));
  const emit = (eventType: string) => { for (const socket of server!.clients) socket.send(JSON.stringify({ type: "pi.event", eventType })); };
  return { state, posts, emit };
}

describe("a gated action in a session", () => {
  it("pins in the dock while it waits, and keeps one quiet line in the thread", async () => {
    await sessionWithGate(idle);
    await until(() => dockButton("Approve and run") !== undefined);
    expect(document.querySelector(".pinned-dock-label")?.textContent).toBe("1 waiting for you");
    expect(document.querySelectorAll(".decision-card")).toHaveLength(1);
    const marker = [...document.querySelectorAll(".event-line")].find((node) => node.textContent?.includes("waits for your approval"));
    expect(marker?.textContent).toContain("build");
    expect(marker?.textContent).toContain("Force-push feat/run-export to origin");
  });

  it("approves from the dock with the cwd; the card leaves the dock and closes in the thread, and reads its result on the change event", async () => {
    const api = await sessionWithGate(idle);
    await until(() => dockButton("Approve and run") !== undefined);
    await act(async () => { dockButton("Approve and run")?.click(); });
    expect(api.posts).toEqual([{ path: `/api/sessions/test/gated-actions/${encodeURIComponent(PUSH.id)}/approve`, body: { cwd: "/work" } }]);
    await until(() => document.querySelector(".pinned-dock") === null);
    expect(document.querySelector(".decision-card-closed")?.textContent).toBe("Approved — running…");
    api.state.records = [PUSH_RAN];
    api.emit("workflow_runs_changed");
    await until(() => document.querySelector(".decision-card-closed")?.textContent === "Approved — ran");
    expect(document.querySelector(".decision-card-detail")?.textContent).toContain("(forced update)");
  });

  it("shows a refused choice on the pinned card, which stays open", async () => {
    await sessionWithGate(idle, { refusal: "This action is not waiting." });
    await until(() => dockButton("Approve and run") !== undefined);
    await act(async () => { dockButton("Approve and run")?.click(); });
    await until(() => document.querySelector(".pinned-dock [role='alert']")?.textContent === "This action is not waiting.");
    expect(document.querySelector(".pinned-dock .decision-card")?.hasAttribute("data-open")).toBe(true);
  });

  it("keeps a waiting gate pinned when its records cannot be read, says why, and Retry recovers", async () => {
    const api = await sessionWithGate(idle, { readFails: true });
    await until(() => document.querySelector(".pinned-dock .alert-card") !== null);
    const dock = document.querySelector(".pinned-dock")!;
    expect(dock.querySelector(".alert-card")?.textContent).toContain("Durable storage is unavailable.");
    expect(dock.querySelector(".decision-card")?.getAttribute("aria-label")).toBe("Force-push feat/run-export to origin");
    expect(dockButton("Approve and run")).toBeDefined();
    expect(document.querySelector(".pinned-dock-label")?.textContent).toBe("1 waiting for you");
    // The thread keeps one line for it, so the card is only in the dock.
    expect(document.querySelectorAll(".decision-card")).toHaveLength(1);
    api.state.readFails = false;
    await act(async () => { dockButton("Retry")?.click(); });
    await until(() => document.querySelector(".pinned-dock .alert-card") === null);
    expect(dockButton("Approve and run")).toBeDefined();
  });

  it("drops the pin once a read that answers says the gate was decided", async () => {
    const api = await sessionWithGate(idle, { readFails: true, records: [PUSH_RAN] });
    await until(() => dockButton("Retry") !== undefined);
    api.state.readFails = false;
    await act(async () => { dockButton("Retry")?.click(); });
    await until(() => document.querySelector(".pinned-dock") === null);
    expect(document.querySelector(".decision-card-closed")?.textContent).toBe("Approved — ran");
  });

  it("offers no choice in a read-only session, and pins nothing", async () => {
    await sessionWithGate({ ...idle, readOnly: true });
    await until(() => document.querySelector(".decision-card-closed")?.textContent === "Waiting for a decision.");
    expect(document.querySelector(".pinned-dock")).toBeNull();
    expect([...document.querySelectorAll("button")].some((node) => node.textContent === "Approve and run")).toBe(false);
  });
});
