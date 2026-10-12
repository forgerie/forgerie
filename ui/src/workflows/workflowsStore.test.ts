import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkflowsStore, type Request } from "./workflowsStore";
import { CHANGES_PROPOSAL, DISMISSED_PROPOSAL, PROPOSAL, PROPOSAL_RUN, START_REFUSED } from "./fixtures/proposals";
import { BUILDING } from "./fixtures/runs";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const SESSION = { id: "s 1", cwd: "/srv/app" };
const BASE = "/api/sessions/s%201";

/** A stand-in for the routes: each call is recorded, and `answer` picks the response. */
function routes(answer: (path: string, init: RequestInit) => Response) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const request: Request = (path, init) => {
    calls.push({ path, method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    return Promise.resolve(answer(path, init));
  };
  return { calls, store: createWorkflowsStore(request, () => SESSION, () => "req-1", 0) };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

afterEach(() => { vi.useRealTimers(); });

describe("a session's workflow proposals", () => {
  it("reads runs and proposals together on a change", async () => {
    const { calls, store } = routes((path) => path.includes("workflow-proposals") ? json(200, [PROPOSAL]) : json(200, [BUILDING]));
    expect(store.getSnapshot().proposals).toBeUndefined();
    store.refresh();
    await settle();
    expect(calls.map((call) => call.path).sort()).toEqual([`${BASE}/workflow-proposals?cwd=%2Fsrv%2Fapp`, `${BASE}/workflow-runs?cwd=%2Fsrv%2Fapp`]);
    expect(store.getSnapshot().proposals).toEqual([PROPOSAL]);
    expect(store.getSnapshot().runs).toEqual([BUILDING]);
  });

  it("keeps what it read before when a read fails, says why, and reads again on retry", async () => {
    let fail = false;
    const { store } = routes((path) => !path.includes("workflow-proposals") ? json(200, []) : fail ? json(500, { error: "Durable storage is unavailable." }) : json(200, [PROPOSAL]));
    store.refresh();
    await settle();
    fail = true;
    store.refresh();
    await settle();
    expect(store.getSnapshot()).toMatchObject({ proposals: [PROPOSAL], proposalsError: "Durable storage is unavailable." });
    fail = false;
    await store.retryProposals();
    expect(store.getSnapshot().proposalsError).toBeUndefined();
  });

  it("starts a proposal with the reader's inputs, adds its run, and closes it as started", async () => {
    const { calls, store } = routes((path) => path.endsWith("/start") ? json(200, PROPOSAL_RUN)
      : path.includes("workflow-proposals") ? json(200, [PROPOSAL]) : json(200, []));
    store.refresh();
    await settle();
    const started = store.startProposal(PROPOSAL.id, { task: "Port it.", rounds: 3 });
    expect(store.getSnapshot().proposing).toEqual({ id: PROPOSAL.id, action: "start" });
    expect(await started).toBe(true);
    expect(calls.find((call) => call.method === "POST")).toEqual({ path: `${BASE}/workflow-proposals/wp-6f2a/start`, method: "POST",
      body: { cwd: "/srv/app", inputs: { task: "Port it.", rounds: 3 }, requestId: "req-1" } });
    const state = store.getSnapshot();
    expect(state.proposing).toBeUndefined();
    expect(state.runs[0]).toEqual(PROPOSAL_RUN);
    expect(state.proposals?.[0]?.state).toEqual({ kind: "started", runId: PROPOSAL_RUN.id, decidedAt: PROPOSAL_RUN.startedAt });
  });

  it("sends a note for changes, and dismisses", async () => {
    const { calls, store } = routes((path) => path.endsWith("/changes") ? json(200, CHANGES_PROPOSAL)
      : path.endsWith("/dismiss") ? json(200, DISMISSED_PROPOSAL) : path.includes("workflow-proposals") ? json(200, [PROPOSAL]) : json(200, []));
    store.refresh();
    await settle();
    expect(await store.askProposalChanges(PROPOSAL.id, "Split the review.")).toBe(true);
    expect(calls.find((call) => call.path.endsWith("/changes"))?.body).toEqual({ cwd: "/srv/app", note: "Split the review." });
    expect(store.getSnapshot().proposals?.[0]).toEqual(CHANGES_PROPOSAL);
    expect(await store.dismissProposal(PROPOSAL.id)).toBe(true);
    expect(calls.find((call) => call.path.endsWith("/dismiss"))?.body).toEqual({ cwd: "/srv/app" });
  });

  it("keeps a refused action's reason for the reader, and sends one decision at a time", async () => {
    let answerStart: (response: Response) => void = () => {};
    const request: Request = (path) => path.endsWith("/start") ? new Promise((resolve) => { answerStart = resolve; }) : Promise.resolve(json(200, []));
    const store = createWorkflowsStore(request, () => SESSION, () => "req-1", 0);
    const first = store.startProposal(PROPOSAL.id, {});
    expect(await store.dismissProposal(PROPOSAL.id)).toBe(false);
    answerStart(json(409, { error: START_REFUSED }));
    expect(await first).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ error: START_REFUSED, proposing: undefined });
  });
});
