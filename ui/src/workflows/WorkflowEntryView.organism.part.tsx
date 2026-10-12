import { WorkflowEntryView } from "./WorkflowEntryView";
import { PROPOSAL, PROPOSAL_ENTRY } from "./fixtures/proposals";
import { BUILDING, CONTRACT_STOP, CONTRACT_WAITING, DECIDED, LAND_STOP, LAND_WAITING, LANDED, STARTED } from "./fixtures/runs";

export const name = "Workflow entry";
export const note = "What a workflow did, as a row in the parent's thread: a proposal, its start, a stop that waits on you, and your decision";

const decide = () => Promise.resolve(true);
export default function ContractStop() {
  return <WorkflowEntryView entry={CONTRACT_STOP} run={CONTRACT_WAITING} onDecide={decide} />;
}
export function ContractApproved() {
  return <WorkflowEntryView entry={CONTRACT_STOP} run={BUILDING} onDecide={decide} />;
}
export function LandStop() {
  return <WorkflowEntryView entry={LAND_STOP} run={LAND_WAITING} onDecide={decide} onReview={() => {}} />;
}
export function Landing() {
  return <WorkflowEntryView entry={LAND_STOP} run={LAND_WAITING} deciding onDecide={decide} onReview={() => {}} />;
}
export function Landed() {
  return <WorkflowEntryView entry={LAND_STOP} run={LANDED} onDecide={decide} />;
}
export function Started() {
  return <WorkflowEntryView entry={STARTED} run={BUILDING} />;
}
export function Decided() {
  return <WorkflowEntryView entry={DECIDED} />;
}
export function Proposal() {
  return <WorkflowEntryView entry={PROPOSAL_ENTRY} proposal={PROPOSAL} proposalsRead onReviewProposal={() => {}} />;
}
