// The workflow sheet's scenarios: a proposal whose plan uses the chat's blocks with one section per stage, the
// session's models, and a run of it at each point that changes what the sheet shows.
import type { SessionModel } from "../../contracts";
import type { ChildTranscript } from "../../childAgents/childAgentsModel";
import type { WorkerModels } from "../WorkerModelPicker";
import type { ChildLook, ProposalEntry, SavedWorkflow, WorkflowProposal, WorkflowRun } from "../workflowsModel";
import { DECIDED_AT, PROPOSAL, PROPOSAL_STAGES, PROSE_PROPOSAL } from "./proposals";

const AT = 1791503600000;
/** The scenarios' clock: 23 minutes after the run started. */
export const SHEET_NOW = AT + 90_000 + 23 * 60_000;

export const MODELS: SessionModel[] = [
  { provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5", reasoning: true },
  { provider: "anthropic", id: "claude-sonnet-5", name: "Claude Sonnet 5", reasoning: true },
  { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5", reasoning: true },
  { provider: "openai", id: "gpt-5", name: "GPT-5", reasoning: true },
  { provider: "google", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", reasoning: true },
];
export const WORKER_MODELS: WorkerModels = { known: MODELS, list: async () => MODELS };
export const AGENTS = ["design-engineer", "full-stack-engineer", "researcher", "reviewer", "scout", "worker"];

/** The plan as an agent writes it under the guidance: the blocks, one `##` section per stage, and no input values. */
export const RICH_TEXT = `---
description: Port settings to the shared store
---
The settings page fetches each setting on its own. This run moves the page and its API onto the shared store. No setting changes what it does.

> [!IMPORTANT]
> Keep every setting's behaviour. If the shape needs a new setting, stop and ask first.

\`\`\`facts
Workers: 3
Stops for you: 2
Branches: 2
\`\`\`

## Shape

This chat writes the store's shape in \`docs/contracts/settings-store.md\`. No worker starts until you approve it.

\`\`\`steps
1. List every setting
   Its type, its default, and the route the page calls today.
2. Name who writes each setting
   The server, the page, or both.
3. Stop for your approval
\`\`\`

## Port the API and the page

Two workers start at the same time, each on its own branch.

\`\`\`files
src/server/settings/
  + store.ts # api: the shared store
  ~ routes.ts # api: read and write through the store
ui/src/settings/
  ~ SettingsPage.tsx # page: read from the store
  - useSettingFetch.ts # page: the store replaces it
\`\`\`

- \`api\` keeps the old routes answering until the page moves.
- \`page\` keeps every control where it is.

## Review

A fresh reviewer reads both branches against the shape and sends its findings back. When the review rounds run out, the run stops and reports.

\`\`\`details
What the reviewer checks
- Each setting in the shape has one reader and one writer.
- No control moved on the page.
- The old routes still answer.
\`\`\`

## Land

You decide when to land. Land \`api\` first, then \`page\`.

> [!WARNING]
> If \`page\` lands before \`api\`, the settings page cannot load until \`api\` lands.`;

export const RICH_PROPOSAL: WorkflowProposal = { ...PROPOSAL, text: RICH_TEXT };
export const RICH_ENTRY: ProposalEntry = { kind: "proposal", proposalId: RICH_PROPOSAL.id, name: RICH_PROPOSAL.name, summary: RICH_PROPOSAL.summary, stages: PROPOSAL_STAGES };
export const RICH_STARTED: WorkflowProposal = { ...RICH_PROPOSAL, state: { kind: "started", runId: "e".repeat(64), decidedAt: DECIDED_AT } };
export const RICH_DISMISSED: WorkflowProposal = { ...RICH_PROPOSAL, state: { kind: "dismissed", decidedAt: DECIDED_AT } };
export const RICH_CHANGES: WorkflowProposal = { ...RICH_PROPOSAL, state: { kind: "changes", decidedAt: DECIDED_AT,
  note: "Split the review in two: one reviewer for the API branch and one for the page." } };
export const PROSE: WorkflowProposal = PROSE_PROPOSAL;

/** A saved workflow file, with its prose, as the library lists it. */
export const SAVED_RICH: SavedWorkflow = {
  name: "settings-store-port", path: "/work/.pi/prompts/settings-store-port.md", sha256: "c3", description: "Port settings to the shared store",
  definition: { version: 1, stages: PROPOSAL_STAGES, inputs: { task: { type: "string" }, base: { type: "string", description: "Branch to land on", choices: ["main", "next"], default: "main" } } },
  text: RICH_TEXT, body: RICH_TEXT.replace(/^---[\s\S]*?---\n/u, ""),
};

const RUN_ID = "e".repeat(64);
const base: WorkflowRun = {
  id: RUN_ID, requestId: "r9", startedAt: AT + 90_000,
  definition: { name: PROPOSAL.name, path: `proposal:${PROPOSAL.id}`, sha256: PROPOSAL.sha256, text: RICH_TEXT },
  inputs: { task: PROPOSAL.inputs["task"] as string, base: "main", rounds: 2 }, state: { kind: "running" }, stages: PROPOSAL_STAGES, children: [],
  stops: { shape: { state: "open", round: 0 }, land: { state: "open", round: 0 } },
};

/** The first stop: this chat wrote the shape, and the run waits for the reader's approval. */
export const RUN_AT_STOP: WorkflowRun = { ...base,
  stops: { shape: { state: "waiting", round: 0, summary: "The shape is in `docs/contracts/settings-store.md`: 14 settings, each with its type, its default and one writer. `theme`, `fontSize` and `density` move from two writers to the server alone." },
    land: { state: "open", round: 0 } } };

/** Port: the shape is approved, `page` is done, `api` works, and the reviewer has not started. */
export const RUN_WORKING: WorkflowRun = { ...base,
  stops: { shape: { state: "approved", round: 1, decidedAt: AT + 300_000 }, land: { state: "open", round: 0 } },
  children: [
    { conversationId: 41, reporterId: 7, name: "api", stage: "port", state: { kind: "working" } },
    { conversationId: 42, reporterId: 8, name: "page", stage: "port", state: { kind: "settled", outcome: "answered", result: "Done.", delivered: true } },
  ] };

/** The reader moved `api` to Opus while its turn ran: the server stored it on the route. */
export const RUN_MODEL_CHANGED: WorkflowRun = { ...RUN_WORKING,
  stages: PROPOSAL_STAGES.map((stage) => stage.id === "port" ? { ...stage, workers: (stage.workers ?? []).map((worker) => worker.name === "api"
    ? { ...worker, model: "anthropic/claude-opus-4-5:high" } : worker) } : stage) };

export const RUN_FINISHED: WorkflowRun = { ...base, state: { kind: "finished", outcome: "completed", finishedAt: AT + 3_600_000,
  result: "Landed `feat/settings-store-api` and `feat/settings-store-page` on main. The settings page reads from the shared store, and every setting behaves as before." },
  stops: { shape: { state: "approved", round: 1 }, land: { state: "approved", round: 1, landed: ["feat/settings-store-api", "feat/settings-store-page"] } },
  children: [
    { conversationId: 41, reporterId: 7, name: "api", stage: "port", state: { kind: "settled", outcome: "answered", result: "Done.", delivered: true } },
    { conversationId: 42, reporterId: 8, name: "page", stage: "port", state: { kind: "settled", outcome: "answered", result: "Done.", delivered: true } },
    { conversationId: 51, reporterId: 9, name: "review", stage: "review", state: { kind: "settled", outcome: "failed", result: "Round 1 failed.", delivered: true } },
    { conversationId: 52, reporterId: 10, name: "review", stage: "review", state: { kind: "settled", outcome: "answered", result: "Passed.", delivered: true } },
  ] };

/** A run of a prose-only workflow: no stages; the agent started two researchers. */
export const PROSE_RUN: WorkflowRun = { ...base, definition: { name: PROSE.name, path: `proposal:${PROSE.id}`, sha256: PROSE.sha256, text: PROSE.text },
  inputs: PROSE.inputs, stages: undefined, stops: undefined,
  children: [
    { conversationId: 61, reporterId: 11, name: "store-hunt", state: { kind: "working" } },
    { conversationId: 62, reporterId: 12, name: "reconnect-hunt", state: { kind: "settled", outcome: "answered", result: "Two flaky tests.", delivered: true } },
  ] };

export const LOOKS: ChildLook[] = [
  { name: "api", agent: "full-stack-engineer", branch: "feat/settings-store-api", asking: false, busy: true },
  { name: "page", agent: "design-engineer", branch: "feat/settings-store-page", asking: false, busy: false },
];

export const API_TRANSCRIPT: ChildTranscript = {
  busy: true,
  messages: [
    { role: "user", content: "Port the settings routes to the shared store in `docs/contracts/settings-store.md`. Keep the old routes answering until the page moves. Work on `feat/settings-store-api`." },
    { role: "assistant", content: [{ type: "toolCall", id: "a2", name: "read", arguments: { path: "docs/contracts/settings-store.md" } }] },
    { role: "toolResult", toolName: "read", content: [{ type: "text", text: "# Settings store\n14 settings, one writer each." }] },
    { role: "assistant", content: [{ type: "text", text: "The shape lists 14 settings. 11 map onto the current routes one to one. `theme`, `fontSize` and `density` are written by both the server and the page today, so the store needs one writer for each." },
      { type: "toolCall", id: "a5", name: "write", arguments: { path: "src/server/settings/store.ts" } }] },
    { role: "toolResult", toolName: "write", content: [{ type: "text", text: "Wrote src/server/settings/store.ts" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "a7", name: "bash", arguments: { command: "npm test -- settings" } }] },
    { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "Test Files  4 passed (4)\n     Tests  38 passed (38)" }] },
  ],
  partial: { role: "assistant", content: [{ type: "text", text: "The routes read and write through the store now, and the 38 settings tests pass. Next I keep `GET /settings/:key` answering from the store for the page's old fetches, then" }] },
};
