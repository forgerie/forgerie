// Fixture proposals for the issue card's parts and tests. Plain data, no clock.
import type { IssueProposal, IssueProposalOutcome } from "../issueProposal";

export const SHORT: IssueProposal = {
  proposalId: "prop-short",
  repo: "forgerie/forgerie",
  title: "Keep the composer draft when the Fold rotates",
  body: "Rotating the unfolded device clears the draft in the composer. The draft should survive the posture change.",
  labels: ["bug", "priority: high"],
};

export const LONG: IssueProposal = {
  proposalId: "prop-long",
  repo: "forgerie/forgerie",
  title: "Show proposed GitHub issues as a card the user creates or dismisses, instead of creating them from the agent's turn",
  body: `## Problem

Today the agent creates an issue directly. The user sees it only after it exists, and cannot stop a duplicate or a wrong repo.

## Proposal

The agent proposes an issue. A card appears in the thread with the title, the repo, the labels and the body. The user taps **Create issue** or **Dismiss**. The server creates the issue without an agent turn, and the card shows the link.

## Acceptance

1. The card works at all four Fold postures.
2. A long body never pushes the buttons out of reach.
3. A second tab that decided first wins; this tab shows that outcome.
4. A failure keeps the card open with the server's words and **Retry**.

## Notes

- Editing the title, body or labels in the card is out of scope.
- Checking for duplicate issues is out of scope.
- \`409\` carries the saved outcome, so a double tap is not an error.

A closing line that only a reader who opened the body will see.`,
  labels: ["enhancement", "priority: medium", "ui", "fold-postures", "accessibility", "area: transcript", "area: github",
    "needs-design", "good first issue", "help wanted", "parking-lot", "regression"],
};

export const NO_LABELS: IssueProposal = {
  proposalId: "prop-plain",
  repo: "simonwjackson/a-repository-with-a-rather-long-name-for-its-owner",
  title: "Document the release checklist",
  body: "Write down the release steps as a checklist.",
  labels: [],
};

type Created = Extract<IssueProposalOutcome, { state: "created" }>;

export const CREATED: Created = {
  state: "created", number: 38, title: SHORT.title, url: "https://github.com/forgerie/forgerie/issues/38",
};
export const CREATED_LONG: Created = {
  state: "created", number: 1204, title: LONG.title, url: "https://github.com/forgerie/forgerie/issues/1204",
};
export const DISMISSED: IssueProposalOutcome = { state: "dismissed" };

export const GITHUB_FAILED = "GitHub refused the issue: label \"fold-postures\" does not exist in forgerie/forgerie.";
