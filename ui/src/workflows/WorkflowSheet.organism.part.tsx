import { useState } from "react";
import { WorkflowSheet } from "./WorkflowSheet";
import type { WorkerRecord } from "./WorkflowWorkerPane";
import { addStage, addWorker, removeWorker, setWorkerModel } from "./workflowRoute";
import type { ProposalAction, WorkflowProposal, WorkflowRun, WorkflowStage } from "./workflowsModel";
import { DECIDED_AT, PROPOSAL_STAGES, READ_FAILED, REPLACED_PROPOSAL, START_REFUSED } from "./fixtures/proposals";
import {
  AGENTS, API_TRANSCRIPT, LOOKS, PROSE, PROSE_RUN, RICH_CHANGES, RICH_DISMISSED, RICH_ENTRY, RICH_PROPOSAL, RICH_STARTED, RUN_AT_STOP, RUN_FINISHED,
  RUN_MODEL_CHANGED, RUN_WORKING, SAVED_RICH, SHEET_NOW, WORKER_MODELS,
} from "./fixtures/sheet";
import { SAVED } from "./fixtures/runs";

export const name = "Workflow sheet";
export const note = "One sheet for a workflow: a saved one before it starts, a proposal, and a run. The plan is the page; the route, inputs and actions are the rail";

/** Real handlers on local state: each action decides at once, and the sheet shows the closed proposal. */
function Proposal({ proposal: initial, entry = RICH_ENTRY, readError, blocked, pending, error, route, editing, changing }: {
  proposal: WorkflowProposal | undefined; entry?: typeof RICH_ENTRY; readError?: string; blocked?: string; pending?: ProposalAction; error?: string;
  route?: WorkflowStage[]; editing?: boolean; changing?: boolean;
}) {
  const [proposal, setProposal] = useState(initial);
  const [failure, setFailure] = useState(readError);
  return <WorkflowSheet mode="start" source={{ kind: "proposal", entry, proposal, readError: failure }} blocked={blocked} pending={pending} error={error}
    models={WORKER_MODELS} agents={AGENTS} initial={{ route, editing, changing }}
    onRetry={() => { setFailure(undefined); setProposal(RICH_PROPOSAL); }}
    onStart={() => setProposal(RICH_STARTED)}
    onChanges={async (text) => { setProposal({ ...RICH_PROPOSAL, state: { kind: "changes", note: text, decidedAt: DECIDED_AT } }); return true; }}
    onDismiss={() => setProposal(RICH_DISMISSED)} onClose={() => {}} />;
}

/** Real handlers: Start says Starting… and stays there. */
function Saved({ workflow = SAVED_RICH, blocked, error, starting = false }: { workflow?: typeof SAVED_RICH; blocked?: string; error?: string; starting?: boolean }) {
  const [pending, setPending] = useState(starting);
  return <WorkflowSheet mode="start" source={{ kind: "saved", workflow, initialTask: "Move the settings page to the shared store." }} blocked={blocked} error={error}
    pending={pending ? "start" : undefined} models={WORKER_MODELS} onStart={() => setPending(true)} onBack={() => {}} onClose={() => {}} />;
}

/** Real handlers: a model change lands on the route, a worker's record opens, and a message joins it. */
function Run({ run: initial, worker, record }: { run: WorkflowRun; worker?: string; record?: WorkerRecord }) {
  const [run, setRun] = useState(initial);
  const [sent, setSent] = useState<string[]>([]);
  const transcript = record?.transcript === undefined ? undefined
    : { ...record.transcript, messages: [...record.transcript.messages, ...sent.map((text) => ({ role: "user" as const, content: text }))] };
  return <WorkflowSheet mode="run" run={run} looks={LOOKS} record={record === undefined ? undefined : { ...record, transcript }} models={WORKER_MODELS}
    initialWorker={worker} now={() => SHEET_NOW}
    onDecide={async (stage) => { setRun((current) => ({ ...current, stops: { ...current.stops, [stage]: { state: "approved", round: 1 } } })); return true; }}
    onOpenWorker={() => {}} onRetryRecord={() => {}} onSteer={async (_id, text) => setSent((current) => [...current, text])} onStopWorker={() => {}}
    onDismissRecordError={() => {}} onModel={async (name, model) => {
      setRun((current) => ({ ...current, stages: setWorkerModel(current.stages ?? [], name, model ?? undefined) })); return true; }} onClose={() => {}} />;
}

const RESHAPED = addStage(addWorker(removeWorker(setWorkerModel(PROPOSAL_STAGES, "api", "anthropic/claude-opus-4-5:high"), "port", "page"), "review", "scout"), "review", "Docs");

// Saved workflow mode
export default function SavedWorkflow() { return <Saved />; }
export function SavedBlocked() { return <Saved blocked="Finish the running workflow before you start another." />; }
export function SavedStarting() { return <Saved starting />; }
export function SavedStartFailed() { return <Saved error={START_REFUSED} />; }
export function SavedProseOnly() { return <Saved workflow={{ ...SAVED[1]!, text: "---\n---\nSplit the question between three researchers. One writer merges their findings with sources.", body: "Split the question between three researchers. One writer merges their findings with sources." }} />; }

// Proposal mode
export function ProposalReview() { return <Proposal proposal={RICH_PROPOSAL} />; }
export function Reading() { return <Proposal proposal={undefined} />; }
export function ReadFailed() { return <Proposal proposal={undefined} readError={READ_FAILED} />; }
export function Blocked() { return <Proposal proposal={RICH_PROPOSAL} blocked="Another workflow is running." />; }
export function AgentBusy() { return <Proposal proposal={RICH_PROPOSAL} blocked="Wait for the agent to finish its turn." />; }
export function Starting() { return <Proposal proposal={RICH_PROPOSAL} pending="start" />; }
export function StartFailed() { return <Proposal proposal={RICH_PROPOSAL} error={START_REFUSED} />; }
export function AskForChanges() { return <Proposal proposal={RICH_PROPOSAL} changing />; }
export function ModelChanged() { return <Proposal proposal={RICH_PROPOSAL} route={setWorkerModel(PROPOSAL_STAGES, "api", "anthropic/claude-opus-4-5:high")} />; }
export function RouteEditing() { return <Proposal proposal={RICH_PROPOSAL} route={RESHAPED} editing />; }
export function RouteChanged() { return <Proposal proposal={RICH_PROPOSAL} route={RESHAPED} />; }
export function UpdateThePlan() { return <Proposal proposal={RICH_PROPOSAL} route={RESHAPED} changing />; }
export function Started() { return <Proposal proposal={RICH_STARTED} />; }
export function Dismissed() { return <Proposal proposal={RICH_DISMISSED} />; }
export function ChangesSent() { return <Proposal proposal={RICH_CHANGES} />; }
export function Replaced() { return <Proposal proposal={{ ...REPLACED_PROPOSAL, text: RICH_PROPOSAL.text }} />; }
export function ProseOnly() { return <Proposal proposal={PROSE} entry={{ kind: "proposal", proposalId: PROSE.id, name: PROSE.name, summary: PROSE.summary, stages: [] }} />; }

// Run mode
export function RunAtStop() { return <Run run={RUN_AT_STOP} />; }
export function RunWorking() { return <Run run={RUN_WORKING} />; }
export function RunWorker() { return <Run run={RUN_WORKING} worker="port/api" record={{ transcript: API_TRANSCRIPT }} />; }
export function RunWorkerModelChanged() { return <Run run={RUN_MODEL_CHANGED} worker="port/api" record={{ transcript: API_TRANSCRIPT }} />; }
export function RunWorkerNotStarted() { return <Run run={RUN_WORKING} worker="review/review" />; }
export function RunRecordLoading() { return <Run run={RUN_WORKING} worker="port/page" record={{}} />; }
export function RunRecordFailed() { return <Run run={RUN_WORKING} worker="port/page" record={{ readError: "The server did not answer in time." }} />; }
export function RunProseOnly() { return <Run run={PROSE_RUN} />; }
export function RunFinished() { return <Run run={RUN_FINISHED} />; }
