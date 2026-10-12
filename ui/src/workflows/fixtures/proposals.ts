import type { ProposalEntry, WorkflowProposal, WorkflowRun, WorkflowStage } from "../workflowsModel";

const AT = 1791503600000;
export const DECIDED_AT = AT + 90_000;

export const PROPOSAL_STAGES: WorkflowStage[] = [
  { id: "shape", name: "Shape", does: "This chat writes the store's shape in docs/contracts/settings-store.md. You approve it.", stop: "approve" },
  { id: "port", name: "Port the API and the page", does: "Two workers, each on its own branch, at the same time.", workers: [
    { name: "api", agent: "full-stack-engineer", model: "anthropic/claude-sonnet-5" },
    { name: "page", agent: "design-engineer" },
  ] },
  { id: "review", name: "Review", does: "A fresh reviewer checks both branches against the shape.", workers: [{ name: "review", agent: "reviewer" }] },
  { id: "land", name: "Land", does: "You land the branches on main.", stop: "land" },
];

const TEXT = `---
description: Port the settings page to the shared store.
inputs:
  task: { type: string }
---
# Port settings to the shared store

1. **Shape.** Write the store's shape: every setting, its type, its default, and who writes it. Stop for approval.
2. **Port.** Start \`api\` on the routes and \`page\` on the view, each on its own branch.
   - \`api\` keeps the old routes answering until the page moves.
   - \`page\` keeps every control where it is.
3. **Review.** A fresh reviewer reads both branches against the shape. Send findings back once; after two rounds, stop and report.
4. **Land.** Stop for the land decision.

Do not change any setting's behaviour. If the shape needs a new setting, ask first.`;

export const PROPOSAL: WorkflowProposal = {
  id: "wp-6f2a", name: "settings-store-port", summary: "Port the settings page to the shared store: agree the shape, move the API and the page in parallel, then a fresh review.",
  text: TEXT, sha256: "c3", createdAt: AT,
  definition: { version: 1, stages: PROPOSAL_STAGES, inputs: {
    task: { type: "string" },
    base: { type: "string", description: "Branch to land on", choices: ["main", "next"], default: "main" },
    rounds: { type: "number", description: "Review rounds before the run stops and reports", default: 2 },
  } },
  inputs: { task: "Move the settings page from its own fetches to the shared store. Keep every setting's current behaviour.", rounds: 2 },
  state: { kind: "open" },
};

export const PROPOSAL_ENTRY: ProposalEntry = { kind: "proposal", proposalId: PROPOSAL.id, name: PROPOSAL.name, summary: PROPOSAL.summary, stages: PROPOSAL_STAGES };

export const STARTED_PROPOSAL: WorkflowProposal = { ...PROPOSAL, state: { kind: "started", runId: "e".repeat(64), decidedAt: DECIDED_AT } };
export const CHANGES_PROPOSAL: WorkflowProposal = { ...PROPOSAL, state: { kind: "changes", decidedAt: DECIDED_AT,
  note: "Split the review in two: one reviewer for the API branch and one for the page. Land the API first, then the page, and stop between them." } };
export const DISMISSED_PROPOSAL: WorkflowProposal = { ...PROPOSAL, state: { kind: "dismissed", decidedAt: DECIDED_AT } };
export const REPLACED_PROPOSAL: WorkflowProposal = { ...PROPOSAL, state: { kind: "replaced", by: "wp-7b10", decidedAt: DECIDED_AT } };

/** A proposal with prose only: no stages, no declared inputs, and a task the agent filled anyway. */
export const PROSE_PROPOSAL: WorkflowProposal = {
  id: "wp-91c0", name: "flaky-test-hunt-across-the-session-store-and-the-reconnect-path",
  summary: "Three researchers each rerun one suite fifty times and report every failure with its seed; this chat merges what they find.",
  text: "Split the suites between three researchers. Each reruns its suite fifty times and reports each failure with its seed and its first stack frame.\n\nMerge the reports into one table, worst first.",
  sha256: "d4", createdAt: AT, definition: { version: 1 }, inputs: { task: "Find the flaky tests in the session store and the reconnect path." }, state: { kind: "open" },
};
export const PROSE_ENTRY: ProposalEntry = { kind: "proposal", proposalId: PROSE_PROPOSAL.id, name: PROSE_PROPOSAL.name, summary: PROSE_PROPOSAL.summary, stages: [] };

/** The run a started proposal makes. */
export const PROPOSAL_RUN: WorkflowRun = {
  id: "e".repeat(64), requestId: "r9", startedAt: AT + 90_000,
  definition: { name: PROPOSAL.name, path: `proposal:${PROPOSAL.id}`, sha256: PROPOSAL.sha256, text: TEXT },
  inputs: PROPOSAL.inputs, state: { kind: "running" }, stages: PROPOSAL_STAGES, children: [],
  stops: { shape: { state: "open", round: 0 }, land: { state: "open", round: 0 } },
};

export const READ_FAILED = "The server did not answer in time.";
export const START_REFUSED = "Another workflow run is active in this session.";
