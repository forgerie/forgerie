import { OldIssueProposalLine } from "./OldIssueProposalLine";
import { CREATED_OLD, DISMISSED_OLD, LONG_OLD, UNDECIDED_OLD, UNLINKED_OLD, UNTITLED_OLD } from "./fixtures/issues";

export const name = "Old issue proposal line";
export const note = "An issue proposal from before agents filed issues, whose card is gone, as one quiet line";

export default function Created() {
  return <OldIssueProposalLine proposal={CREATED_OLD} />;
}
export function Dismissed() {
  return <OldIssueProposalLine proposal={DISMISSED_OLD} />;
}
export function Undecided() {
  return <OldIssueProposalLine proposal={UNDECIDED_OLD} />;
}
export function Untitled() {
  return <OldIssueProposalLine proposal={UNTITLED_OLD} />;
}
export function Unlinked() {
  return <OldIssueProposalLine proposal={UNLINKED_OLD} />;
}
export function LongTitle() {
  return <OldIssueProposalLine proposal={LONG_OLD} />;
}
