import { useState } from "react";
import { WorkflowProposalSheet } from "./WorkflowProposalSheet";
import type { ProposalAction, WorkflowProposal } from "./workflowsModel";
import {
  DECIDED_AT, DISMISSED_PROPOSAL, PROPOSAL, PROPOSAL_ENTRY, PROSE_ENTRY, PROSE_PROPOSAL, READ_FAILED, REPLACED_PROPOSAL, START_REFUSED, STARTED_PROPOSAL,
} from "./fixtures/proposals";

export const name = "Workflow proposal sheet";
export const note = "A proposed workflow before it starts: the inputs the agent filled, the route, the full instructions, and Start, Ask for changes, Dismiss";

/** Real handlers on local state: each action decides at once, and the sheet then shows the closed proposal. */
function Deciding({ proposal: initial, entry = PROPOSAL_ENTRY, blocked, error, pending, readError }: {
  proposal?: WorkflowProposal | undefined; entry?: typeof PROPOSAL_ENTRY; blocked?: string; error?: string; pending?: ProposalAction; readError?: string;
}) {
  const [proposal, setProposal] = useState(initial);
  const [failure, setFailure] = useState(readError);
  return <WorkflowProposalSheet entry={entry} proposal={proposal} readError={failure} blocked={blocked} error={error} pending={pending}
    onRetry={() => { setFailure(undefined); setProposal(PROPOSAL); }}
    onStart={() => setProposal(STARTED_PROPOSAL)}
    onChanges={async (text) => { setProposal({ ...PROPOSAL, state: { kind: "changes", note: text, decidedAt: DECIDED_AT } }); return true; }}
    onDismiss={() => setProposal(DISMISSED_PROPOSAL)} onClose={() => {}} />;
}

export default function Review() { return <Deciding proposal={PROPOSAL} />; }
export function Reading() { return <Deciding />; }
export function ReadFailed() { return <Deciding readError={READ_FAILED} />; }
export function AnotherRunActive() { return <Deciding proposal={PROPOSAL} blocked="Another workflow is running." />; }
export function AgentBusy() { return <Deciding proposal={PROPOSAL} blocked="Wait for the agent to finish its turn." />; }
export function Starting() { return <Deciding proposal={PROPOSAL} pending="start" />; }
export function StartFailed() { return <Deciding proposal={PROPOSAL} error={START_REFUSED} />; }
export function ProseOnly() { return <Deciding proposal={PROSE_PROPOSAL} entry={PROSE_ENTRY} />; }
export function Replaced() { return <Deciding proposal={REPLACED_PROPOSAL} />; }
