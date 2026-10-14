# Filing GitHub issues

Only the parent uses `file_issue`. A child suggests issues in its report.
Search open and closed issues with `github_read` first. Filing does not ask the
user to approve a card and does not end the turn. The old `propose_issue` tool
and create/dismiss routes are removed. `github_write` still cannot create issues.
Closing an issue without `agent-filed` still requires a gated action.

## Input and result

`src/shared/fileIssues.ts` defines `FileIssueInputSchema` / `FileIssueInput` and
`FileIssueResultSchema` / `FileIssueResult`.

| Input | Rule |
| --- | --- |
| `title` | Nonblank, 1–256 characters; must contain a word or number. |
| `body` | Markdown, at most 65,000 characters. |
| `labels?` | At most 20 existing names, 1–50 characters each. Only `agent-filed` can be created. |
| `duplicates` | 1–20 nonblank search queries the parent already ran, at most 200 characters each. This is the parent's report, not proof of earlier tool calls. |
| `notDuplicateOf?` | At most 100 distinct positive issue numbers the parent checked and found to be different work. |
| `worktreeId?` | An owned secondary checkout from `project_worktree`; omit for the starting repository. |

The client pins one resolved repository for search, label checks, and creation.
The tool runs sequentially within a parent. Its result details are one of:

```ts
{ state: "duplicate", repo: string,
  matches: { number: number, title: string, state: "open" | "closed", url: string }[] }
{ state: "created", repo: string, number: number, title: string, url: string,
  agentFiled: boolean, labelWarning?: string }
```

Duplicate refusal is an error tool result. It returns every close match,
including overridden ones, if any match lacks an override. It creates nothing
and logs no decision. Match titles follow the existing contributor trust rule:
comparison uses the original title, but outside contributors' titles stay hidden
unless the project lists everyone.

## Duplicate rule

Normalize titles with Unicode NFKC, lowercase them, and split into Unicode
letter/number words. Titles match when their normalized word sequences are
equal. Otherwise they match when they share at least three unique words and
`2 * shared / (leftWords + rightWords) >= 0.8` (Dice similarity).

The client searches title words with GitHub's search API, scoped by
`repo:<slug> is:issue in:title`, without a state filter. It prefers longer words.
For `n` unique title words, a close match must share at least
`min(n, max(3, ceil(2*n/3)))` words. Searching one more than the maximum number
of missing words makes every close match share at least one search term.
Each query pages through up to 1,000 results. An incomplete search, a larger
result set, or an invalid response refuses filing. No partial search is treated
as permission to create an issue.

This rule catches wording overlap, not semantic duplicates or spelling errors.
GitHub's search index can lag creation. Search API limits still apply; broad
terms can require a more specific title. Separate parents can race to file the
same issue. The parent's earlier searches remain necessary.

## Labels and decisions

The client lists all label pages and shares in-flight checks within one process.
It creates `agent-filed` only if missing. A second process winning the label
creation race is accepted after a fresh label check. Completed checks are not
cached: GitHub remains the source of truth.

If GitHub refuses label creation, the issue is still filed with its other labels.
The result sets `agentFiled: false` and explains the failure in `labelWarning`
and tool text. A missing label in the creation response is also reported, not
claimed as attached. This explicit fallback is an exception to ADR 0002's every-issue
label goal. It keeps the backlog write, but that issue cannot be found by the
label and closing it remains gated. Unknown caller-supplied labels still refuse
filing before any write.

Success calls `logDecision` in the parent conversation. The record uses
`id: "issue:<lowercase repo>:<number>"`, `kind: "issue"`, `by: "parent"`, the title
as `question`, `"#<number> <url>"` as `choice`, the reported queries as `reason`,
and `flagged: false`. The existing decision log attaches the active run.

There is no new custom transcript message. The existing `file_issue` tool call
and tool result remain visible; the result's `details` have the shape above.
A decision update emits the existing `workflow_runs_changed` notification.

GitHub creation and the local decision commit cannot be atomic. A crash or a
lost creation response can leave an issue without a decision. Check GitHub
before retrying. An explicit decision-commit failure reports the created number
and URL and tells the parent not to file again. The tool is replay-unsafe.

## Historical transcript reader

`src/shared/legacyIssueProposals.ts` is read-only compatibility. It exports
`readLegacyIssueEntry`, these constants, and the corresponding schemas/types.
The full browser projection keeps the custom messages and their original
`details`. Preview details remain bounded. Invalid old details do not crash
projection or turn into an actionable card.

| `customType` / constant | `details` / exported shape |
| --- | --- |
| `forgerie.issue-proposal` / `ISSUE_PROPOSAL_TYPE` | `LegacyIssueProposalRecordSchema` / `LegacyIssueProposalRecord`: `{ proposal: { proposalId, repo, title, body, labels: string[], outcome? }, targetCwd }` |
| `forgerie.issue-proposal-outcome` / `ISSUE_PROPOSAL_OUTCOME_TYPE` | `LegacyIssueProposalDecisionSchema` / `LegacyIssueProposalDecision`: `{ proposalId, outcome }` |

`outcome` is `{ state: "dismissed" }` or
`{ state: "created", number, title, url }`.
The UI can render the proposal as `Proposed issue (old card): <title>`.
No historical message exposes a create/dismiss action.

## Real-model acceptance

```sh
FILE_ISSUE_REAL=1 nix shell nixpkgs#nodejs_24 -c npx tsx scripts/file-issue-real.ts
```

This uses a temporary profile and a real model, but all GitHub requests use an
in-memory API. It proves a close duplicate is refused, the parent stops, and a
later distinct issue gets the label and an issue decision. It writes its evidence
to the temporary directory named in stdout. It never creates real GitHub data.
