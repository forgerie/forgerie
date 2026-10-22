# Backlog suggestions

`suggest_backlog` saves follow-up work without filing it or ending the current turn.
The tool is model-only and parent-only. Children put suggestions in their reports;
the parent calls the tool. Use it when you would say “we should backlog this”.
Use [`file_issue`](file-issues.md) only when the user asks to file now.

The tool accepts `{ title, body, why, files: string[], decisions: string[] }`.
Titles have at most 200 characters (the issue duplicate-search limit).
Its result details are `{ suggestionId, destination }`.
A suggestion belongs to the calling chat and its registered project.
It stays after archive. It never expires.

| User action | Result |
| --- | --- |
| File | Files the item. The current chat continues. |
| File and act | Files the item, then starts a new session in a fresh worktree. The server sends its initial prompt. The browser stays in the current chat. |
| Dismiss | Hides an unfiled suggestion without deleting it. Restore keeps its prior state, including unsafe failures. |
| File anyway | Acknowledges displayed matches: `notDuplicateOf` issue numbers for GitHub, or `acknowledgedPaths` for Markdown. Any new unacknowledged match stops filing. It never overwrites or comments on a match. |
| Start session after a launch error | Starts work from the existing filed receipt. It never files again. |

Title and body can be overridden when filing, not after filing. Each item includes
`## Context` with Why, Files, and Decisions, then
`Suggested in <chat title> (<session id>), <date>`.

## Destination and Git safety

Creation freezes the first provider in the project's resolved `backlog.providers`.
Only project-owned Markdown and GitHub providers are writable. Azure boards are
read-only. If an Azure source routes to the project, `azureReadOnlyNote` is true.
Later settings changes do not redirect an existing suggestion.

Markdown uses `backlog.dir`, default `.forgerie/backlog/`. The saved destination
starts with `<YYYY-MM-DD>-<slug>.md`; a collision with an existing closed item
allocates `-2.md`, `-3.md`, and so on. The chosen path is stored before committing.
Changing the title on File does not otherwise change that identity. Frontmatter contains `id`, `title`, `status: To Do`, `created`, and
`source: forgerie-suggestion <sessionId>/<suggestionId>`.

Filing uses a scratch worktree under `.worktrees/forgerie-backlog-scratch/<suggestionId>` from the local default branch.
A private Git index and `commit-tree` create the commit before a checkout holds
the item. This avoids even a temporary uncommitted item in a checkout. The commit
uses the user's Git identity and `chore(backlog): add <title>`. The writer uses the
same per-main-checkout queue and dirty-path overlap rule as Land. Main must be on
the default branch. Unrelated dirty main files are allowed. The writer fast-forwards
main with `--no-overwrite-ignore` and never pushes. Ignored local drafts are not overwritten. It removes scratch files, worktree, and branch before the
fast-forward, so a cleanup failure cannot leave an item on main. Existing paths
are never overwritten. Open Markdown duplicates use the same title
rule as `file_issue`; the writer checks them before writing.

GitHub uses `githubAgent.fileIssue` against the saved repo, checks duplicates, and
adds `agent-filed`. A known creation invalidates that repo's cached backlog listings
before background launch, including lists already in flight. It logs the existing issue decision in the source chat. An
archived or removed-worktree chat gets the decision through an inactive-journal
writer, without resuming the chat. The writer uses the existing Durable ownership
lock. A racing owner can prevent the decision write; `decisionLogWarning` preserves
the known issue number and URL. Do not file it again.

## Models and storage

Model and thinking defaults resolve per field in this order:

1. This File and act request's `modelSpec` / `thinkingLevel` override.
2. Project `backlog.suggestions`.
3. Global `suggestionsDefault` in `backlog-settings.json`.
4. The source chat's model and thinking level.

Creation stores the resolved default in `defaultModel`. The first File and act
saves its resolved `launchChoice` on `filing` and then `filed`. That choice remains
while `launchError` is set. A launch-only retry uses the saved choice and ignores
a different request model or thinking override, so it can reuse an existing
session and claim. A request override never changes project or global settings. See [configuration](config.md#backlog-settings).

Sessiond owns `<data dir>/backlog-suggestions.json`. It uses atomic replacement,
mode `0600`, revisions, and durable request receipts. It keeps suggestions and
request results, not a second background-session status store. Background status
comes from the normal session list.

On startup, Forgerie sweeps its reserved `forgerie-backlog-scratch/` branch
namespace, matching scratch worktrees, and private Git index files. For an
interrupted Markdown filing, it checks the default branch's item with
`parseBacklogItem` and requires the exact unique `source`. A match becomes filed;
a pending File and act continues only launch, with its saved model override.
Without a verified item, state becomes retryable failed. A pre-existing closed
same-title file is not a filing receipt. Orphan scratch with no filing record is
also removed. Ordinary worktrees and branches are never swept. If a project
cannot be read, startup logs a recovery warning. Restore its folder/default
branch and restart sessiond to finish that project's recovery.

A lost GitHub creation response is ambiguous. Startup marks that filing unsafe;
inspect GitHub before suggesting again. It is not automatically retried. If filing
succeeds but launch fails, state stays `filed` with `launchError`; a new request can
retry only launch. Durable prompt request IDs prevent a repeated initial prompt.

## HTTP contract

Routes have `/api` in the browser and no prefix inside sessiond. The existing
backlog proxy forwards them.

- `GET /api/backlog/suggestions?sessionId=&state=` returns `{ suggestions: [...] }`, newest first.
- `POST /api/backlog/suggestions/:id/file` accepts `{ requestId, title?, body?, notDuplicateOf?, acknowledgedPaths? }`.
- `POST /api/backlog/suggestions/:id/file-and-act` accepts the same fields plus `modelSpec?`, `thinkingLevel?`.
- `POST /api/backlog/suggestions/:id/dismiss` and `/restore` accept `{}`.

POST returns the updated record. A repeated request ID returns its saved result;
reusing it with different choices returns 409. Use a new ID for a launch retry.
Wrong state returns 409 with `BacklogErrorSchema`. Open, duplicate, and retryable
failed records can file. Failed state includes `action: "file" | "file-and-act"`,
so a retry after reload repeats the failed action. Filed records accept only file-and-act without edits.
Restore accepts dismissed records only. Dismissed state stores `{ at, restoreTo }`,
where `restoreTo` is the prior open, duplicate, or failed state. An unsafe GitHub
failure stays `failed` with `retryable: false` after Dismiss and Restore.

Changes emit the global event
`{ type: "backlog.suggestions.changed", sessionId, suggestionId }`.
They are not per-session `pi.event` messages.

## Acceptance

```sh
BACKLOG_SUGGESTIONS_REAL=1 npx tsx scripts/backlog-suggestions-real.ts
```

The script refuses to run unless `BACKLOG_SUGGESTIONS_REAL=1` is set, before it
reads `~/.local/share/forgerie/agent/cliproxyapi.json`. That opt-in permits a real
model request with the existing CLIProxyAPI credentials. The script keeps the
key in runtime memory only; it does not write it into the temporary model config,
auth storage, or evidence files.

This uses a real model, an in-memory GitHub API, a temporary profile and a temporary
Git repo. It checks suggestion and continued chat, duplicate refusal, File anyway,
the label and decision, a Markdown commit and fast-forward, a server-prompted fresh
worktree background session, and request replay. It never writes to live GitHub
or pushes. The script prints the evidence directory and deletes its temporary
model configuration when it exits. No model key is left in its files.
