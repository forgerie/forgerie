import { useState } from "react";
import { IssueProposalCard, type IssueDecision, type IssueDecisionFailure } from "./IssueProposalCard";
import type { IssueProposal, IssueProposalOutcome } from "./issueProposal";
import { CREATED, CREATED_LONG, DISMISSED, GITHUB_FAILED, LONG, NO_LABELS, SHORT } from "./fixtures/proposals";

export const name = "Issue proposal card";
export const note = "An issue the agent proposes, in the thread: the reader creates it or dismisses it, and the card closes to one line";

const outcomeFor = (proposal: IssueProposal, decision: IssueDecision): IssueProposalOutcome => decision === "dismiss" ? DISMISSED
  : { state: "created", number: 38, title: proposal.title, url: CREATED.url };

/** Real handlers on local state: a press decides at once. */
function Deciding({ proposal, pending, failure, outcome: initial }: {
  proposal: IssueProposal; pending?: IssueDecision; failure?: IssueDecisionFailure; outcome?: IssueProposalOutcome;
}) {
  const [outcome, setOutcome] = useState(initial);
  return <IssueProposalCard proposal={proposal} outcome={outcome} pending={pending} failure={failure}
    onCreate={() => { setOutcome(outcomeFor(proposal, "create")); }} onDismiss={() => { setOutcome(outcomeFor(proposal, "dismiss")); }} />;
}

export default function Open() { return <Deciding proposal={SHORT} />; }
export function LongBodyManyLabels() { return <Deciding proposal={LONG} />; }
export function NoLabels() { return <Deciding proposal={NO_LABELS} />; }
export function Creating() { return <Deciding proposal={SHORT} pending="create" />; }
export function Dismissing() { return <Deciding proposal={SHORT} pending="dismiss" />; }
export function Failed() { return <Deciding proposal={SHORT} failure={{ decision: "create", message: GITHUB_FAILED }} />; }
export function FailedLong() { return <Deciding proposal={LONG} failure={{ decision: "create", message: GITHUB_FAILED }} />; }
export function Created() { return <Deciding proposal={SHORT} outcome={CREATED} />; }
export function CreatedLongTitle() { return <Deciding proposal={LONG} outcome={CREATED_LONG} />; }
export function Dismissed() { return <Deciding proposal={SHORT} outcome={DISMISSED} />; }
export function ReadOnly() { return <IssueProposalCard proposal={LONG} />; }
export function ReadOnlyCreated() { return <IssueProposalCard proposal={SHORT} outcome={CREATED} />; }
