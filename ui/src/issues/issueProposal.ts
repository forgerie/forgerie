/** Contract between the issue card and its data. Build and design create this file byte-identical; neither changes it. */
export interface IssueProposal {
  proposalId: string;
  /** The repo the issue goes to, as owner/name. */
  repo: string;
  title: string;
  /** Markdown. */
  body: string;
  labels: string[];
  /** Absent while the proposal waits for the user. */
  outcome?: IssueProposalOutcome;
}

export type IssueProposalOutcome =
  | { state: "created"; number: number; title: string; url: string }
  | { state: "dismissed" };

/** System-message metadata the transcript sets on a proposal's row. */
export interface IssueProposalArtifact { issueProposal: IssueProposal }
