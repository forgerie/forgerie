import type { FileIssueResult } from "../fileIssueResult";
import type { OldIssueProposal } from "../oldIssueProposal";

export const DRAFT_TITLE = "Retry after a failed send loses the composer draft";
export const LONG_TITLE = "Session picker keeps a closed worktree's sessions in the list after the worktree is removed, and opening one shows an empty transcript with no way back except a reload of the whole app";

export const CREATED_OLD: OldIssueProposal = {
  proposalId: "ip-3f1c", title: DRAFT_TITLE, outcome: { state: "created", number: 142, url: "https://github.com/forgerie/forgerie/issues/142" },
};
export const DISMISSED_OLD: OldIssueProposal = { proposalId: "ip-77a0", title: "Show the card idea from the design review", outcome: { state: "dismissed" } };
/** The card closed with no choice recorded on this branch. */
export const UNDECIDED_OLD: OldIssueProposal = { proposalId: "ip-9b2e", title: DRAFT_TITLE };
/** An entry whose details and text name no title. */
export const UNTITLED_OLD: OldIssueProposal = { outcome: { state: "dismissed" } };
/** A created outcome whose address is not a web address keeps its number, unlinked. */
export const UNLINKED_OLD: OldIssueProposal = { proposalId: "ip-0c4d", title: DRAFT_TITLE, outcome: { state: "created", number: 142 } };
export const LONG_OLD: OldIssueProposal = {
  proposalId: "ip-51aa", title: LONG_TITLE, outcome: { state: "created", number: 1204, url: "https://github.com/forgerie/forgerie/issues/1204" },
};

export const FILED: Extract<FileIssueResult, { state: "created" }> = {
  state: "created", repo: "forgerie/forgerie", number: 143, title: DRAFT_TITLE, url: "https://github.com/forgerie/forgerie/issues/143", agentFiled: true,
};
/** GitHub refused to create the agent-filed label, so the issue went in without it. */
export const LABEL_WARNING = "GitHub refused to create the agent-filed label (403: Resource not accessible by integration). Filed without it.";
export const DUPLICATE: Extract<FileIssueResult, { state: "duplicate" }> = { state: "duplicate", repo: "forgerie/forgerie", matches: [
  { number: 142, title: DRAFT_TITLE, state: "closed", url: "https://github.com/forgerie/forgerie/issues/142" },
  { number: 98, title: "Composer draft lost after a failed retry", state: "open", url: "https://github.com/forgerie/forgerie/issues/98" },
] };
