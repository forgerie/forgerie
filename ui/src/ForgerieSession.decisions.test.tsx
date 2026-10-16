// @vitest-environment happy-dom
import { withOpenFixture } from "./testing/openFixture";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocketServer, WebSocket as Socket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgerieSession } from "./ForgerieSession";
import { browserTransport } from "./sessionStore";
import type { PiMessage, SessionStatus } from "./contracts";
import type { Decision } from "./decisions/decisionsModel";
import { ANSWER, GUESS, LOG_NOW, OVERTURNED } from "./decisions/fixtures/decisions";

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

const messages: PiMessage[] = [
  { role: "user", content: "Export run history as CSV." },
  { role: "assistant", content: [{ type: "text", text: "The build worker is on it. I answered its question about archived runs." }] },
];

/** A Durable session whose agents made decisions. The routes answer from `state`, which a test changes as the server would. */
async function sessionWithDecisions(status: SessionStatus, options: { decisions?: Decision[]; readFails?: boolean; opener?: string } = {}) {
  const state = { decisions: options.decisions ?? [ANSWER, GUESS, OVERTURNED], readFails: options.readFails ?? false };
  const posts: { path: string; body: unknown }[] = [];
  const reads = { decisions: 0 };
  server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("No socket port");
  vi.spyOn(browserTransport, "connect").mockImplementation(() => new Socket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocket);
  vi.spyOn(browserTransport, "watchRecovery").mockImplementation(() => () => {});
  vi.spyOn(browserTransport, "request").mockImplementation(withOpenFixture(async (path, init) => {
    if (init.method === "POST") posts.push({ path, body: JSON.parse(String(init.body)) });
    if (path === "/api/sessions/unread") return Response.json({ catalogId: "test", sessions: [] });
    if (path.endsWith(`/decisions/${GUESS.id}/overturn`)) {
      const note = (JSON.parse(String(init.body)) as { note: string }).note;
      const done: Decision = { ...GUESS, state: { kind: "overturned", note, at: LOG_NOW } };
      state.decisions = state.decisions.map((decision) => decision.id === done.id ? done : decision);
      return Response.json(done);
    }
    if (path.includes("/decisions?")) {
      reads.decisions += 1;
      return state.readFails ? Response.json({ error: "Durable storage is unavailable." }, { status: 500 }) : Response.json(state.decisions);
    }
    if (path.includes("/children?")) return Response.json([]);
    if (path.includes("/workflow-proposals?") || path.includes("/workflow-runs?")) return Response.json([]);
    if (path.includes("/messages?")) return Response.json({ messages, start: 0, total: messages.length });
    if (path.includes("/stream-snapshot?")) return Response.json({ partial: null, seq: 0 });
    if (path.includes("/status?")) return Response.json(status);
    if (path.includes("/commands?")) return Response.json([]);
    return Response.json({ error: "Not found" }, { status: 404 });
  }));
  await act(async () => root.render(<ForgerieSession id="test" known={{ id: "test", cwd: "/work" }} onSwitchSession={() => {}} />));
  await until(() => button(options.opener ?? "Decisions, 1 flagged guess to look at") !== undefined);
  const emit = (eventType: string) => { for (const socket of server!.clients) socket.send(JSON.stringify({ type: "pi.event", eventType })); };
  return { state, posts, reads, emit };
}

describe("a session's decision log", () => {
  it("counts the flagged guess quietly in the header, and pins nothing in the dock", async () => {
    await sessionWithDecisions({ ...idle, flaggedDecisions: 1 });
    const opener = button("Decisions, 1 flagged guess to look at")!;
    expect(opener.hasAttribute("data-quiet")).toBe(true);
    expect(opener.hasAttribute("data-waiting")).toBe(false);
    expect(document.querySelector(".pinned-dock")).toBeNull();
    expect(document.body.textContent).not.toContain("waiting for you");
  });

  it("overturns from the sheet and posts the note with the cwd; the count follows", async () => {
    const api = await sessionWithDecisions({ ...idle, flaggedDecisions: 1 });
    await act(async () => { button("Decisions, 1 flagged guess to look at")?.click(); });
    await until(() => document.querySelector("dialog[open]")?.textContent?.includes(GUESS.question) === true);
    const row = [...document.querySelectorAll(".decision-record")].find((node) => node.textContent?.includes(GUESS.question))!;
    await act(async () => { row.querySelector("button")!.click(); });
    const field = document.querySelector<HTMLTextAreaElement>("dialog[open] .sheet-dialog-foot textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Group by stage.");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { button("Send and overturn")?.click(); });
    expect(api.posts).toEqual([{ path: `/api/sessions/test/decisions/${GUESS.id}/overturn`, body: { cwd: "/work", note: "Group by stage." } }]);
    // No longer a flagged guess: it moves to its day's lines, open, with its new state.
    await until(() => [...document.querySelectorAll("dialog[open] .disclosure-row .decision-record")]
      .find((node) => node.textContent?.includes(GUESS.question))?.querySelector(".decision-record-status")?.textContent === "Overturned");
    expect(document.querySelector("dialog[open] .sheet-dialog-foot")).toBeNull();
    expect(button("Decisions")).toBeDefined();
    expect(button("Decisions, 1 flagged guess to look at")).toBeUndefined();
  });

  it("offers the log after a failed first read, with no flagged guess and no run, and Retry recovers it", async () => {
    const api = await sessionWithDecisions(idle, { decisions: [ANSWER], readFails: true, opener: "Decisions" });
    expect(document.querySelector(".stage-strip")).toBeNull();
    await act(async () => { button("Decisions")?.click(); });
    await until(() => document.querySelector("dialog[open] .alert-card")?.textContent?.includes("Durable storage is unavailable.") === true);
    expect(document.querySelector("dialog[open] .decision-record")).toBeNull();
    api.state.readFails = false;
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>("dialog[open] button")].find((node) => node.textContent === "Retry")?.click(); });
    await until(() => document.querySelector("dialog[open] .disclosure-row-title")?.textContent === ANSWER.question);
    expect(document.querySelector("dialog[open] .alert-card")).toBeNull();
    expect(button("Decisions")).toBeDefined();
  });

  it("reads the log again when the server says the workflow records changed", async () => {
    const api = await sessionWithDecisions({ ...idle, flaggedDecisions: 1 });
    const before = api.reads.decisions;
    api.state.decisions = [{ ...GUESS, id: "d-9", at: LOG_NOW }, ...api.state.decisions];
    api.emit("workflow_runs_changed");
    await until(() => button("Decisions, 2 flagged guesses to look at") !== undefined);
    expect(api.reads.decisions).toBeGreaterThan(before);
  });
});
