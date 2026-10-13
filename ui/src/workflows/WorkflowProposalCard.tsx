import { ActionFooter } from "../ui/ActionFooter";
import { DecisionCard } from "../ui/DecisionCard";
import { MarkdownFragment } from "../ui/MarkdownFragment";
import { proposalGlance, proposalIsOpen, proposalOutcome, type ProposalEntry, type WorkflowProposal } from "./workflowsModel";

/**
 * Shape: a workflow the agent proposes for the current task, in the thread.
 * It renders from its transcript entry at once: the name, the overview, and
 * the route at a glance, with Review. In a short container, such as the dock
 * on a phone on its side, it is its title line and Review. Once decided it closes to one line:
 * Started, the changes asked for, Dismissed, or replaced by a newer proposal.
 * Without `onReview` the reader cannot decide here, so the card says it waits.
 */
export function WorkflowProposalCard({ entry, proposal, read, onReview }: {
  entry: ProposalEntry;
  /** The session's record of this proposal, as last read. */
  proposal?: WorkflowProposal | undefined;
  /** Whether the session's proposals were read at least once. Before that, the card trusts its entry and stays open. */
  read: boolean;
  /** Opens the proposal's sheet. Absent where the reader cannot decide, such as a read-only transcript. */
  onReview?: (() => void) | undefined;
}) {
  const waiting = proposalIsOpen(proposal, read);
  const open = waiting && onReview !== undefined;
  return <DecisionCard title={entry.name} meta="Proposed workflow" open={open}
    closed={waiting ? "Waiting for a decision." : proposalOutcome(proposal)}
    // Review is the card's one action: in a short container the card compacts to its title line and Review, and the sheet keeps the rest.
    action={open ? { label: "Review", onPress: onReview } : undefined}
    footer={open && <ActionFooter note={proposalGlance(entry.stages)} actions={[]} />}>
    {entry.summary.trim() === "" ? undefined : <MarkdownFragment text={entry.summary} />}
  </DecisionCard>;
}
