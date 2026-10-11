import { CircleDotIcon } from "lucide-react";
import { ActionFooter } from "../ui/ActionFooter";
import { DecisionCard } from "../ui/DecisionCard";
import { Excerpt } from "../ui/Excerpt";
import { MarkdownFragment } from "../ui/MarkdownFragment";
import { TagList } from "../ui/TagList";
import type { IssueProposal, IssueProposalOutcome } from "./issueProposal";

/** A decision on its way to the server. */
export type IssueDecision = "create" | "dismiss";
/** The last decision that failed, with the server's words. Local to this card; the transcript never records it. */
export interface IssueDecisionFailure { decision: IssueDecision; message: string }

/**
 * Shape: an issue the agent proposes, in the thread. It shows what will be
 * filed (title, repo, labels, the body cut to a few lines) and waits for
 * Create issue or Dismiss. Once decided it closes to one line: a link to the
 * new issue, or Dismissed. Without handlers the reader cannot decide here,
 * so the card says it waits.
 */
export function IssueProposalCard({ proposal, outcome, pending, failure, onCreate, onDismiss }: {
  proposal: Pick<IssueProposal, "repo" | "title" | "body" | "labels">;
  /** What was decided. Undefined while the proposal waits. */
  outcome?: IssueProposalOutcome | undefined;
  pending?: IssueDecision | undefined;
  failure?: IssueDecisionFailure | undefined;
  /** Absent where the reader cannot decide, such as a read-only transcript. */
  onCreate?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
}) {
  const decidable = outcome === undefined && onCreate !== undefined && onDismiss !== undefined;
  const busy = pending !== undefined;
  const retry = !busy && failure?.decision === "create";
  const hasBody = proposal.body.trim() !== "";
  const details = outcome === undefined && (hasBody || proposal.labels.length > 0);
  return <DecisionCard icon={<CircleDotIcon />} title={proposal.title} meta={proposal.repo} open={decidable}
    closed={outcome?.state === "created" ? `Created #${String(outcome.number)}: ${outcome.title}`
      : outcome?.state === "dismissed" ? "Dismissed" : "Waiting for a decision."}
    closedHref={outcome?.state === "created" ? outcome.url : undefined}
    problem={busy ? undefined : failure?.message}
    footer={decidable && <ActionFooter actions={[
      { label: pending === "dismiss" ? "Dismissing…" : "Dismiss", onPress: onDismiss, disabled: busy },
      { label: pending === "create" ? "Creating…" : retry ? "Retry" : "Create issue", onPress: onCreate, disabled: busy, tone: "primary" },
    ]} />}>
    {details ? <>
      <TagList label="Labels" tags={proposal.labels} />
      {hasBody && <Excerpt label="Issue body"><MarkdownFragment text={proposal.body} /></Excerpt>}
    </> : undefined}
  </DecisionCard>;
}
