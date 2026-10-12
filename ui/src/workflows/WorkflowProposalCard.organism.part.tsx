import { useState } from "react";
import { WorkflowProposalCard } from "./WorkflowProposalCard";
import type { WorkflowProposal } from "./workflowsModel";
import { CHANGES_PROPOSAL, DISMISSED_PROPOSAL, PROPOSAL, PROPOSAL_ENTRY, PROSE_ENTRY, PROSE_PROPOSAL, REPLACED_PROPOSAL, STARTED_PROPOSAL } from "./fixtures/proposals";

export const name = "Workflow proposal card";
export const note = "A workflow the agent proposes for the current task, in the thread: Review opens it, and the card closes to one line once decided";

/** Real handlers on local state: Review here stands in for the sheet, and starts the proposal at once. */
function Reviewing({ proposal }: { proposal: WorkflowProposal }) {
  const [current, setCurrent] = useState(proposal);
  return <WorkflowProposalCard entry={PROPOSAL_ENTRY} proposal={current} read onReview={() => setCurrent(STARTED_PROPOSAL)} />;
}

export default function Open() { return <Reviewing proposal={PROPOSAL} />; }
export function BeforeTheRecord() { return <WorkflowProposalCard entry={PROPOSAL_ENTRY} read={false} onReview={() => {}} />; }
export function ProseOnlyLongName() { return <WorkflowProposalCard entry={PROSE_ENTRY} proposal={PROSE_PROPOSAL} read onReview={() => {}} />; }
export function Started() { return <Reviewing proposal={STARTED_PROPOSAL} />; }
export function ChangesAsked() { return <Reviewing proposal={CHANGES_PROPOSAL} />; }
export function Dismissed() { return <Reviewing proposal={DISMISSED_PROPOSAL} />; }
export function Replaced() { return <Reviewing proposal={REPLACED_PROPOSAL} />; }
export function Gone() { return <WorkflowProposalCard entry={PROPOSAL_ENTRY} read onReview={() => {}} />; }
export function ReadOnly() { return <WorkflowProposalCard entry={PROPOSAL_ENTRY} proposal={PROPOSAL} read />; }
