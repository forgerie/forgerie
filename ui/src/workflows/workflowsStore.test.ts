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
  it("cancels once, reads the final state after the request, and reports a refusal", async () => {
    const stopping = { ...BUILDING, state: { kind: "stopping" } };
    const stopped = { ...BUILDING, state: { kind: "finished", outcome: "stopped", result: "Stopped", finishedAt: 100 } };
    let cancelled = false;
    let fail = false;
    const { calls, store } = routes((path) => {
      if (path.endsWith("/cancel")) { cancelled = true; return fail ? json(409, { error: "Already finished" }) : json(200, stopping); }
      return path.includes("workflow-proposals") ? json(200, []) : json(200, [cancelled ? stopped : BUILDING]);
    });
    store.refresh(); await settle();
    const pending = store.cancel(BUILDING.id);
    expect(store.getSnapshot().cancelling).toBe(BUILDING.id);
    expect(await store.cancel(BUILDING.id)).toBe(false);
    expect(await pending).toBe(true);
    await settle();
    expect(store.getSnapshot().runs[0]).toEqual(stopped);
    expect(calls.find((call) => call.path.endsWith("/cancel"))).toMatchObject({ method: "POST", body: { cwd: SESSION.cwd } });
    fail = true;
    expect(await store.cancel(BUILDING.id)).toBe(false);
    expect(store.getSnapshot().error).toBe("Already finished");
    store.dispose();
  });
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

  it("ignores a read that answers after a newer one, so a decided proposal never opens again", async () => {
    // Every GET waits until the test answers it, in the order the test chooses.
    const held: { path: string; answer: (response: Response) => void }[] = [];
    const request: Request = (path, init) => init.method === "POST"
      ? Promise.resolve(path.endsWith("/dismiss") ? json(200, DISMISSED_PROPOSAL) : json(200, []))
      : new Promise((resolve) => { held.push({ path, answer: resolve }); });
    const store = createWorkflowsStore(request, () => SESSION, () => "req-1", 0);
    const proposalReads = () => held.filter((read) => read.path.includes("workflow-proposals"));
    store.refresh();
    await settle();
    // The old read is still out when the reader dismisses.
    const old = proposalReads()[0]!;
    expect(await store.dismissProposal(PROPOSAL.id)).toBe(true);
    expect(store.getSnapshot().proposals).toEqual([DISMISSED_PROPOSAL]);
    // The read after the decision answers first, then the old one, which still says open.
    const after = proposalReads()[1]!;
    after.answer(json(200, [DISMISSED_PROPOSAL]));
    await settle();
    old.answer(json(200, [PROPOSAL]));
    await settle();
    expect(store.getSnapshot().proposals).toEqual([DISMISSED_PROPOSAL]);
  });

  it("drops a read that started before an accepted decision, even when it answers before the next read", async () => {
    const held: { path: string; answer: (response: Response) => void }[] = [];
    const request: Request = (path, init) => init.method === "POST" ? Promise.resolve(json(200, PROPOSAL_RUN))
      : new Promise((resolve) => { held.push({ path, answer: resolve }); });
    const store = createWorkflowsStore(request, () => SESSION, () => "req-1", 0);
    store.refresh();
    await settle();
    const [oldRuns, oldProposals] = [held.find((read) => read.path.includes("workflow-runs"))!, held.find((read) => read.path.includes("workflow-proposals"))!];
    expect(await store.startProposal(PROPOSAL.id, { task: "Port it." })).toBe(true);
    oldRuns.answer(json(200, []));
    oldProposals.answer(json(200, [PROPOSAL]));
    await settle();
    // The run strip keeps its run; the old answers came from before the start.
    expect(store.getSnapshot().runs).toEqual([PROPOSAL_RUN]);
    expect(store.getSnapshot().proposals).toBeUndefined();
  });

  it("drops the failure of a read that a newer read replaced", async () => {
    const held: ((response: Response) => void)[] = [];
    const request: Request = (path) => path.includes("workflow-proposals") ? new Promise((resolve) => { held.push(resolve); }) : Promise.resolve(json(200, []));
    const store = createWorkflowsStore(request, () => SESSION, () => "req-1", 0);
    store.refresh();
    await settle();
    void store.retryProposals();
    held[1]!(json(200, [PROPOSAL]));
    await settle();
    held[0]!(json(500, { error: "Old failure." }));
    await settle();
    expect(store.getSnapshot()).toMatchObject({ proposals: [PROPOSAL], proposalsError: undefined });
  });
});

describe("workers' models", () => {
  it("sends the models the reader changed with a proposal's start and a saved workflow's launch, and nothing when none changed", async () => {
    const { calls, store } = routes((path) => path.endsWith("/start") || path.endsWith("/workflow-runs") ? json(200, PROPOSAL_RUN) : json(200, []));
    await store.startProposal(PROPOSAL.id, { task: "Port it." }, { api: "anthropic/claude-opus-4-5:high", page: null });
    await store.launch("design-build-review", { task: "Export" }, { design: "openai/gpt-5" });
    await store.launch("design-build-review", { task: "Export" });
    expect(calls.filter((call) => call.method === "POST").map((call) => call.body)).toEqual([
      { cwd: "/srv/app", inputs: { task: "Port it." }, models: { api: "anthropic/claude-opus-4-5:high", page: null }, requestId: "req-1" },
      { cwd: "/srv/app", name: "design-build-review", inputs: { task: "Export" }, models: { design: "openai/gpt-5" }, requestId: "req-1" },
      { cwd: "/srv/app", name: "design-build-review", inputs: { task: "Export" }, requestId: "req-1" },
    ]);
  });

  it("moves a running worker to another model and keeps the run the server answers", async () => {
    const moved = { ...BUILDING, stages: BUILDING.stages?.map((stage) => stage.id === "build"
      ? { ...stage, workers: stage.workers?.map((worker) => worker.name === "build" ? { ...worker, model: "openai/gpt-5" } : worker) } : stage) };
    const { calls, store } = routes((path) => path.endsWith("/model") ? json(200, moved) : json(200, [BUILDING]));
    store.refresh();
    await settle();
    const pending = store.setWorkerModel(BUILDING.id, "build", "openai/gpt-5");
    expect(store.getSnapshot().modelling).toBe(`${BUILDING.id}/build`);
    expect(await pending).toBe(true);
    expect(calls.at(-1)).toEqual({ path: `${BASE}/workflow-runs/${BUILDING.id}/workers/build/model`, method: "POST", body: { cwd: "/srv/app", model: "openai/gpt-5" } });
    expect(store.getSnapshot()).toMatchObject({ modelling: undefined, runs: [moved] });
    await store.setWorkerModel(BUILDING.id, "build", null);
    expect(calls.at(-1)?.body).toEqual({ cwd: "/srv/app", model: null });
  });

  it("reads a worker the server put on the session's model, written as null, as a worker with no model", async () => {
    // As the server stores it: `null` for the session's model, in the run list and in the model route's answer.
    const wire = (run: typeof BUILDING) => JSON.parse(JSON.stringify(run, (key, value: unknown) => key === "workers"
      ? (value as { name: string }[]).map((worker) => worker.name === "design" ? { ...worker, model: null } : worker) : value)) as unknown;
    const onSession = (run: typeof BUILDING) => ({ ...run, stages: run.stages?.map((stage) => ({ ...stage, ...stage.workers === undefined ? {}
      : { workers: stage.workers.map((worker) => worker.name === "design" ? { name: worker.name, agent: worker.agent } : worker) } })) });
    const { store } = routes((path) => path.endsWith("/model") ? json(200, wire(BUILDING)) : json(200, [wire(BUILDING)]));
    store.refresh();
    await settle();
    expect(store.getSnapshot().runs).toEqual([onSession(BUILDING)]);
    const design = store.getSnapshot().runs[0]?.stages?.[1]?.workers?.[0];
    expect(design).toEqual({ name: "design", agent: "design-engineer" });
    expect(design).not.toHaveProperty("model");
    expect(await store.setWorkerModel(BUILDING.id, "design", null)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ error: undefined, runs: [onSession(BUILDING)] });
  });

  it("says why a model change was refused, and reads the runs again", async () => {
    const { calls, store } = routes((path) => path.endsWith("/model") ? json(409, { error: "Workflow run is not running" }) : json(200, [BUILDING]));
    expect(await store.setWorkerModel(BUILDING.id, "build", "openai/gpt-5")).toBe(false);
    await settle();
    expect(store.getSnapshot()).toMatchObject({ modelling: undefined, error: "Workflow run is not running" });
    expect(calls.at(-1)?.path).toBe(`${BASE}/workflow-runs?cwd=%2Fsrv%2Fapp`);
  });
});
