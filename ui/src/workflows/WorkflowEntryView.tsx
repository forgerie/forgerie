import { DecisionCard } from "../ui/DecisionCard";
import { EventLine } from "../ui/EventLine";
import { MarkdownFragment } from "../ui/MarkdownFragment";
import { WorkflowProposalCard } from "./WorkflowProposalCard";
import { WorkflowStopChoices } from "./WorkflowStopChoices";
import { stopIsOpen, stopOutcome, type StopDecision, type WorkflowEntry, type WorkflowProposal, type WorkflowRun } from "./workflowsModel";

/**
 * Shape: one thing a workflow did, in the parent's thread. Its start and each
 * decision are one line. A stop is a card that waits on the reader until the
 * run says it was decided; an older round of the same stop stays closed. A
 * proposal is a card that waits until the reader starts, changes or dismisses it.
 */
export function WorkflowEntryView({ entry, run, deciding = false, onDecide, onReview, proposal, proposalsRead = false, onReviewProposal }: {
  entry: WorkflowEntry;
  /** The run this entry belongs to, as the server last reported it. */
  run?: WorkflowRun | undefined;
  deciding?: boolean;
  /** Absent where the reader cannot decide, such as a read-only transcript. */
  onDecide?: ((decision: StopDecision, note?: string) => Promise<boolean>) | undefined;
  /** Opens the children, to read their branches before landing. */
  onReview?: (() => void) | undefined;
  /** The session's record of a proposal entry, as last read. */
  proposal?: WorkflowProposal | undefined;
  /** Whether the session's proposals were read at least once. */
  proposalsRead?: boolean;
  /** Opens a proposal's sheet. Absent where the reader cannot decide. */
  onReviewProposal?: (() => void) | undefined;
}) {
  switch (entry.kind) {
    case "started": {
      const task = run?.inputs["task"];
      return <EventLine tone="active" subject={run?.definition.name ?? "workflow"} phrase="started" quoteFace="text"
        quote={typeof task === "string" && task.trim() !== "" ? task : undefined} detail={<MarkdownFragment text={entry.text} />} />;
    }
    case "decided": return <EventLine tone="positive" subject="you" quoteFace="text"
      phrase={entry.text.replace(/^The user /u, "").replace(/\.$/u, "")} />;
    case "proposal": return <WorkflowProposalCard entry={entry} proposal={proposal} read={proposalsRead} onReview={onReviewProposal} />;
    case "stop": {
      const open = onDecide !== undefined && stopIsOpen(run, entry);
      return <DecisionCard title={entry.stageName} meta={entry.workflow}
        open={open} closed={stopIsOpen(run, entry) ? "Waiting for a decision." : stopOutcome(run, entry)}
        footer={open && <WorkflowStopChoices entry={entry} deciding={deciding} onDecide={onDecide} onReview={onReview} />}>
        <MarkdownFragment text={entry.summary} />
      </DecisionCard>;
    }
  }
}
