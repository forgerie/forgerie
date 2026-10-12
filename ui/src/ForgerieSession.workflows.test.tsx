// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebSocketServer, WebSocket as Socket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgerieSession } from "./ForgerieSession";
import { browserTransport } from "./sessionStore";
import type { PiMessage, SessionStatus } from "./contracts";
import { PROPOSAL, PROPOSAL_RUN, PROPOSAL_STAGES, STARTED_PROPOSAL } from "./workflows/fixtures/proposals";

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
  { role: "user", content: "Port the settings page to the shared store." },
  { role: "assistant", content: [{ type: "text", text: "Here is a workflow for it. Review it below." }] },
  { role: "custom", customType: "forgerie.workflow-proposal", content: "",
    details: { proposalId: PROPOSAL.id, name: PROPOSAL.name, summary: PROPOSAL.summary, stages: PROPOSAL_STAGES } },
];

/** A session whose agent proposed a workflow. The routes answer from `state`, which a test changes as the server would. */
async function sessionWithProposal(status: SessionStatus = idle) {
  const state = { proposals: [PROPOSAL], runs: [] as unknown[] };
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
    if (path.endsWith(`/workflow-proposals/${PROPOSAL.id}/start`)) {
      state.runs = [PROPOSAL_RUN];
      state.proposals = [STARTED_PROPOSAL];
      return Response.json(PROPOSAL_RUN);
    }
    if (path.includes("/workflow-proposals?")) return Response.json(state.proposals);
    if (path.includes("/workflow-runs?")) return Response.json(state.runs);
    if (path.includes("/messages?")) return Response.json({ messages, start: 0, total: messages.length });
    if (path.includes("/stream-snapshot?")) return Response.json({ partial: null, seq: 0 });
    if (path.includes("/status?")) return Response.json(status);
    if (path.includes("/commands?")) return Response.json([]);
    return Response.json({ error: "Not found" }, { status: 404 });
  });
  await act(async () => root.render(<ForgerieSession id="test" known={{ id: "test", cwd: "/work" }} onSwitchSession={() => {}} />));
  await until(() => document.querySelector(".pinned-dock") !== null);
  return { posts };
}

describe("a workflow the agent proposes", () => {
  it("pins the card above the composer, keeps a line in the thread, and starts from the sheet", async () => {
    const api = await sessionWithProposal();
    const dock = document.querySelector(".pinned-dock");
    expect(dock?.getAttribute("aria-label")).toBe("1 waiting for you");
    expect(dock?.textContent).toContain("4 stages · 3 workers · 2 stops");
    expect(document.body.textContent).toContain(`${PROPOSAL.name}waits for your review, pinned below the thread`);
    await act(async () => { button("Review")?.click(); });
    await until(() => document.querySelector("dialog[open]")?.textContent?.includes("Full instructions") === true);
    await act(async () => { button("Start workflow")?.click(); });
    expect(api.posts).toEqual([{ path: `/api/sessions/test/workflow-proposals/${PROPOSAL.id}/start`,
      body: { cwd: "/work", inputs: { task: PROPOSAL.inputs["task"], rounds: 2 }, requestId: expect.any(String) } }]);
    await until(() => document.querySelector("dialog[open]") === null);
    await until(() => document.querySelector(".stage-strip")?.getAttribute("aria-label")?.startsWith(`Open the ${PROPOSAL.name} run`) === true);
    expect(document.querySelector(".pinned-dock")).toBeNull();
    await until(() => document.querySelector(".decision-card-closed")?.textContent === "Started");
  });

  it("holds Start while the agent's turn runs", async () => {
    await sessionWithProposal({ ...idle, isStreaming: true });
    await act(async () => { button("Review")?.click(); });
    await until(() => button("Start workflow") !== undefined);
    expect(button("Start workflow")?.disabled).toBe(true);
    expect(document.querySelector("dialog[open] .action-footer-note")?.textContent).toBe("Wait for the agent to finish its turn.");
  });
});
