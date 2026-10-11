# Issue proposals

The agent uses `propose_issue` to offer a new GitHub issue. The user creates or
dismisses it in chat. The tool checks the repository and existing labels, then
continues the agent's work. `github_write` no longer accepts `create_issue`.

The tool takes `title` (1–256 characters), `body` (Markdown, at most 65,000
characters), optional `labels` (at most 20 existing names, 1–50 characters each),
and optional `worktreeId` for a secondary repository owned by the session.
The proposal pins the resolved `owner/name` repository.

Browser decisions use these endpoints with body `{ "cwd": "/absolute/path" }`:

| Endpoint | Success |
| --- | --- |
| `POST /api/sessions/:sessionId/issue-proposals/:proposalId/create` | `200` with `{state:"created", number, title, url}` |
| `POST /api/sessions/:sessionId/issue-proposals/:proposalId/dismiss` | `200` with `{state:"dismissed"}` |

An already decided proposal returns `409` with `{error, outcome}`. A proposal
outside the current branch returns `404`. Invalid bodies return `400`.
GitHub failures return `502` with `{error}` and leave the proposal open for retry.

Proposals and outcomes are custom messages on the session branch. A decision
reaches the browser stream at once, including during an agent run. The model
reads the outcome as text on its next turn. A decision does not start a turn.
The browser folds the outcome into the proposal row rather than adding a row.
The server serializes decisions per session and proposal.

A crash after GitHub creates an issue but before the server saves its outcome
can leave an open proposal. Check GitHub before retrying in that case.
