// Mockup only. A workflow run in progress, as the run mode of the sheet shows
// it: where each stage stands, each worker's runs as tally blocks, and each
// worker's live record. A build reads this from the run record and the
// child transcripts the child agents panel already reads.
import type { ExchangeLine } from "../../src/ui/ExchangeLog";
import { PROPOSAL_RUN } from "../../src/workflows/fixtures/proposals";
import type { StopEntry, WorkflowRun } from "../../src/workflows/workflowsModel";
import { SETTINGS_PORT, type MockProposal } from "./planDocument";
import type { StageProgress } from "./ProposalSheet";

/** One block per child run, in the tally's tones. */
export type BlockState = "done" | "working" | "waiting" | "failed" | "next";

export interface LiveWorker {
  name: string;
  agent?: string | undefined;
  /** The model it started on. */
  model?: string | undefined;
  /** One per run of this worker, oldest first. A planned run that has not started is "next". */
  runs: readonly BlockState[];
  /** Where it stands, in a few words. */
  status: string;
  busy: boolean;
  /** A block line whose content is a string is a divider between runs, such as review rounds. */
  lines: readonly ExchangeLine[];
}

export interface LiveStage { id: string; progress: StageProgress; status?: string | undefined; workers: readonly LiveWorker[] }

export interface LiveRun {
  proposal: MockProposal;
  /** The header's status line. */
  status: string;
  /** The footer's note. */
  note: string;
  stages: readonly LiveStage[];
  inputs: readonly (readonly [string, string])[];
  /** A stop that waits on the reader. The same card is in the chat. */
  stop?: { entry: StopEntry; run: WorkflowRun } | undefined;
}

const API_LINES: ExchangeLine[] = [
  { kind: "in", key: "a1", label: "Task from this chat", text: "Port the settings routes to the shared store in `docs/contracts/settings-store.md`. Keep the old routes answering until the page moves. Work on `feat/settings-store-api`." },
  { kind: "call", key: "a2", name: "read", summary: "docs/contracts/settings-store.md" },
  { kind: "call", key: "a3", name: "read", summary: "src/server/settings/routes.ts" },
  { kind: "out", key: "a4", text: "The shape lists 14 settings. 11 map onto the current routes one to one. `theme`, `fontSize` and `density` are written by both the server and the page today, so the store needs one writer for each." },
  { kind: "call", key: "a5", name: "write", summary: "src/server/settings/store.ts" },
  { kind: "call", key: "a6", name: "edit", summary: "src/server/settings/routes.ts" },
  { kind: "call", key: "a7", name: "bash", summary: "npm test -- settings" },
  { kind: "output", key: "a8", name: "bash", isError: false, text: "Test Files  4 passed (4)\n     Tests  38 passed (38)" },
  { kind: "out", key: "a9", streaming: true, text: "The routes read and write through the store now, and the 38 settings tests pass. Next I keep `GET /settings/:key` answering from the store for the page's old fetches, then" },
];

const PAGE_LINES: ExchangeLine[] = [
  { kind: "in", key: "p1", label: "Task from this chat", text: "Move `SettingsPage` from its own fetches to the shared store. Keep every control where it is. Work on `feat/settings-store-page`." },
  { kind: "call", key: "p2", name: "edit", summary: "ui/src/settings/SettingsPage.tsx" },
  { kind: "call", key: "p3", name: "bash", summary: "rm ui/src/settings/useSettingFetch.ts" },
  { kind: "call", key: "p4", name: "bash", summary: "npm test -- SettingsPage" },
  { kind: "output", key: "p5", name: "bash", isError: false, text: "Tests  12 passed (12)" },
  { kind: "out", key: "p6", text: "Done. `SettingsPage` reads from the store, every control is where it was, and 12 tests pass. 3 commits on `feat/settings-store-page`." },
];

/** settings-store-port in Port: the shape is approved, `page` is done, and `api` works. */
export const SETTINGS_LIVE: LiveRun = {
  proposal: SETTINGS_PORT,
  status: "Running for 23 min, stage 2 of 4",
  note: "Started 23 min ago. The next stop for you is Land.",
  inputs: [["Task", String(SETTINGS_PORT.proposed.task)], ["Branch to land on", "main"], ["Review rounds", "2"]],
  stages: [
    { id: "shape", progress: "done", status: "You approved the shape.", workers: [] },
    { id: "port", progress: "current", status: "1 of 2 workers done.", workers: [
      { name: "api", agent: "full-stack-engineer", model: "anthropic/claude-sonnet-5", runs: ["working"], status: "Working for 9 min", busy: true, lines: API_LINES },
      { name: "page", agent: "design-engineer", runs: ["done"], status: "Done in 6 min, 3 commits", busy: false, lines: PAGE_LINES },
    ] },
    { id: "review", progress: "next", workers: [{ name: "review", agent: "reviewer", runs: ["next"], status: "Starts when both branches are ready", busy: false, lines: [] }] },
    { id: "land", progress: "next", workers: [] },
  ],
};

/** settings-store-port at its first stop: this chat wrote the shape, and the run waits for your approval. */
export const SETTINGS_STOP: LiveRun = {
  ...SETTINGS_LIVE,
  status: "Waiting for you, stage 1 of 4",
  note: "Started 4 min ago. Nothing else runs until you decide.",
  stages: [
    { id: "shape", progress: "waiting", status: "Approve the shape to go on.", workers: [] },
    { id: "port", progress: "next", workers: [
      { name: "api", agent: "full-stack-engineer", model: "anthropic/claude-sonnet-5", runs: ["next"], status: "Starts after your approval", busy: false, lines: [] },
      { name: "page", agent: "design-engineer", runs: ["next"], status: "Starts after your approval", busy: false, lines: [] },
    ] },
    { id: "review", progress: "next", workers: [{ name: "review", agent: "reviewer", runs: ["next"], status: "Starts when both branches are ready", busy: false, lines: [] }] },
    { id: "land", progress: "next", workers: [] },
  ],
  stop: {
    entry: { kind: "stop", runId: PROPOSAL_RUN.id, stage: "shape", stageName: "Shape", stop: "approve", workflow: SETTINGS_PORT.name, round: 0,
      summary: "The shape is in `docs/contracts/settings-store.md`: 14 settings, each with its type, its default and one writer. `theme`, `fontSize` and `density` move from two writers to the server alone." },
    run: { ...PROPOSAL_RUN, stops: { shape: { state: "waiting", summary: "The shape is ready.", round: 0 }, land: { state: "open", round: 0 } } },
  },
};
