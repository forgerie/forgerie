import type { ChildLook, SavedWorkflow, StopEntry, WorkflowEntry, WorkflowRun, WorkflowStage } from "../workflowsModel";

const AT = 1791500000000;
const RUN_ID = "7f1c2a9b3e4d5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8";

export const STAGES: WorkflowStage[] = [
  { id: "contract", name: "Contract", does: "This chat writes the contract. You approve it.", stop: "approve" },
  { id: "build", name: "Design and build", does: "Two workers, each on its own branch, at the same time.", workers: [
    { name: "design", agent: "design-engineer", model: "anthropic/claude-opus-5.5" },
    { name: "build", agent: "full-stack-engineer" },
  ] },
  { id: "review", name: "Review", does: "A fresh reviewer checks every branch against the contract.", workers: [{ name: "review", agent: "reviewer" }] },
  { id: "land", name: "Land", does: "You land the branches on the default branch.", stop: "land" },
];

export const SAVED: SavedWorkflow[] = [
  { name: "design-build-review", path: "/agent/prompts/design-build-review.md", sha256: "a1", description: "Contract, then design and build in parallel, then a fresh review. You approve the contract and the landing.",
    definition: { version: 1, inputs: { task: { type: "string" } }, stages: STAGES } },
  { name: "research-sweep", path: "/agent/prompts/research-sweep.md", sha256: "b2", description: "Several researchers split a question; one writer merges their findings with sources.",
    definition: { version: 1, inputs: { task: { type: "string" } } } },
];

const base: Omit<WorkflowRun, "stops" | "children" | "state"> = {
  id: RUN_ID, requestId: "r1", startedAt: AT,
  definition: { name: "design-build-review", path: "/agent/prompts/design-build-review.md", sha256: "a1", text: "" },
  inputs: { task: "Export run history as CSV: one endpoint and an Export button with empty and error states." },
  stages: STAGES,
};

export const CONTRACT_WAITING: WorkflowRun = { ...base, state: { kind: "running" }, children: [],
  stops: { contract: { state: "waiting", summary: "The contract is in docs/contracts/run-export.md.", round: 0 }, land: { state: "open", round: 0 } } };

export const BUILDING: WorkflowRun = { ...base, state: { kind: "running" },
  stops: { contract: { state: "approved", decidedAt: AT + 240_000, round: 1 }, land: { state: "open", round: 0 } },
  children: [
    { conversationId: 15, reporterId: 4, name: "design", stage: "build", state: { kind: "working" } },
    { conversationId: 21, reporterId: 5, name: "build", stage: "build", state: { kind: "working" } },
  ] };

export const FAILED: WorkflowRun = { ...BUILDING, state: { kind: "finished", outcome: "failed", result: "The build worker failed.", finishedAt: AT + 1_200_000 },
  children: [
    { conversationId: 15, reporterId: 4, name: "design", stage: "build", state: { kind: "settled", outcome: "answered", result: "Done.", delivered: true } },
    { conversationId: 21, reporterId: 5, name: "build", stage: "build", state: { kind: "settled", outcome: "failed", result: "Build failed.", delivered: true } },
  ] };

export const LAND_WAITING: WorkflowRun = { ...base, state: { kind: "running" },
  stops: { contract: { state: "approved", round: 1 }, land: { state: "waiting", summary: "Two branches are ready.", round: 0 } },
  children: [
    { conversationId: 15, reporterId: 4, name: "design", stage: "build", state: { kind: "settled", outcome: "answered", result: "Done.", delivered: true } },
    { conversationId: 21, reporterId: 5, name: "build", stage: "build", state: { kind: "settled", outcome: "answered", result: "Done.", delivered: true } },
    { conversationId: 33, reporterId: 9, name: "review", stage: "review", state: { kind: "settled", outcome: "answered", result: "Passed.", delivered: true } },
  ] };

export const LANDED: WorkflowRun = { ...LAND_WAITING, state: { kind: "finished", outcome: "completed", result: "Landed both branches.", finishedAt: AT + 2_400_000 },
  stops: { contract: { state: "approved", round: 1 }, land: { state: "approved", landed: ["feat/run-export-api", "design/run-export"], round: 1 } } };

export const CHILD_LOOKS = [
  { name: "design", agent: "design-engineer", branch: "design/run-export", asking: false },
  { name: "build", agent: "full-stack-engineer", branch: "feat/run-export-api", asking: false },
];

export const CONTRACT_STOP: StopEntry = { kind: "stop", runId: RUN_ID, stage: "contract", stageName: "Contract", stop: "approve", workflow: "design-build-review", round: 0,
  summary: "The contract is in `docs/contracts/run-export.md`. It fixes the endpoint `GET /sessions/:id/child-runs.csv`, the columns in sheet order, and the four states of the button." };
export const LAND_STOP: StopEntry = { kind: "stop", runId: RUN_ID, stage: "land", stageName: "Land", stop: "land", workflow: "design-build-review", round: 0,
  summary: "Review passed in round 2. Two branches are ready: `feat/run-export-api` (5 commits) and `design/run-export` (5 commits)." };
export const STARTED: WorkflowEntry = { kind: "started", runId: RUN_ID, text: "Agree a contract, build the interface and the endpoint at the same time, then review." };
export const DECIDED: WorkflowEntry = { kind: "decided", workflow: "design-build-review", text: "The user approved \"Contract\"." };

/** The preview's clock for a retry countdown. */
export const RUN_NOW = AT + 600_000;

/**
 * design waits to retry a model error; build answered, but the parent already had that answer, so the report was
 * not sent again; docs, a child the agent added, was stopped before it reported; tests answered, but its reporter
 * failed, so the agent never heard.
 */
export const UNSENT: WorkflowRun = { ...BUILDING,
  children: [
    { conversationId: 15, reporterId: 4, name: "design", stage: "build", state: { kind: "working" } },
    { conversationId: 21, reporterId: 5, name: "build", stage: "build", state: { kind: "settled", outcome: "answered", result: "Done.", delivered: "duplicate" } },
    { conversationId: 33, reporterId: 9, name: "docs", stage: "build", state: { kind: "settled", outcome: "stopped", result: "aborted", delivered: "aborted" } },
    { conversationId: 34, reporterId: 10, name: "tests", stage: "build",
      state: { kind: "settled", outcome: "answered", result: "Added 6 tests.", delivered: false, deliveryError: "Completion reporter faulted: Disk full" } },
  ] };

export const RETRY_LOOKS: ChildLook[] = [
  { ...CHILD_LOOKS[0]!, retry: { attempt: 2, max: 3, until: RUN_NOW + 100_000,
    error: '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_011CUyb5k8Yx2Q3r"}' } },
  CHILD_LOOKS[1]!,
];
