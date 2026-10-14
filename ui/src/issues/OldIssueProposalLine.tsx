import { EventSentence } from "../ui/EventSentence";
import type { OldIssueProposal } from "./oldIssueProposal";

/**
 * Shape: an issue proposal from before agents filed issues themselves. Its
 * card is gone, so one quiet line names it and says what became of it:
 * "— created" with the issue's number, linked to the issue, or
 * "— dismissed". With no outcome on the branch, the dot is hollow: the card
 * closed without a choice. Nothing here can act.
 */
export function OldIssueProposalLine({ proposal: { title, outcome } }: { proposal: OldIssueProposal }) {
  const created = outcome?.state === "created" ? `created #${String(outcome.number)}` : undefined;
  return <EventSentence tone={outcome?.state === "created" ? "positive" : "neutral"} hollow={outcome === undefined}>
    Proposed issue (old card){title !== undefined && <>: <strong>{title}</strong></>}
    {outcome?.state === "dismissed" && " — dismissed"}
    {outcome?.state === "created" && <> — {outcome.url === undefined ? created
      : <a href={outcome.url} target="_blank" rel="noreferrer">{created}</a>}</>}
  </EventSentence>;
}
