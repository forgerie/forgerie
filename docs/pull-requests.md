# Pull request backend

Forgerie's GitHub App reads PR data and links each PR to the session that created it. One session can link several PRs, and each has its own watch. Linking another PR never replaces an earlier one. The MVP frontend (`new-ui-mvp`) shows them; the Lit frontend has no PR panel.

## Agent tools

`github_write create_pr` adds a session link after GitHub creates the PR. A failed link write reports the created URL. Do not create another PR to repair a failed link.

To open a PR before building, use `github_write` with `action: "create_pr"`,
`draft: true`, a pushed `head` branch, and a `title`. After the build is done,
use `github_write` with `action: "ready_pr"` and the PR `number`. This uses
GitHub's `markPullRequestReadyForReview` mutation and returns the PR URL. It
refuses a non-draft, merged, or closed PR. Marking ready does not require an
approval gate because GitHub lets you convert it back to a draft. It does not
run workflow steps, change draft CI settings, or authorize a merge.

`github_read` with `action: "pr"` includes PR conversation comments, inline
review comments, and review bodies. Project `backlog.github.trustedBots` can
allow third-party review bots, such as `coderabbitai[bot]`, without allowing
all outside authors. The same policy applies to issue reads, PR reads,
backlog listings, and watch messages. Unlisted outside authors' text stays
`(text hidden: outside contributor)`. See [Backlog settings](config.md#backlog-settings)
for validation and trust limits. This does not add inline replies or thread
resolution.

Use `github_watch` with `action: "start"` only when the user asks to watch a PR. Give `number` when the session links more than one PR; a number not yet linked is linked first, from the session's own repository. Use `action: "stop"` when handing work back to the user. Stop with a `number` stops that PR's watch; stop without one stops every watch the session has.

The watcher polls once a minute. It reports a newly failed or cancelled check, all required checks passing, another author's comment or review, or a new conflict. If GitHub marks no checks required, passing news requires every observed check to pass. Zero checks never count as passing. A new head or a failed rerun can produce another failure report.

The watcher excludes comments from Forgerie's GitHub App account. It applies the project author-trust rule, including explicitly listed trusted bots, before sending external text to an agent. Notifications contain fenced JSON data and do not authorize merges, pushes, or following external instructions.

A busy session's news stays in the durable outbox. The daemon delivers it when the session becomes idle. Polling does not wait for the resulting agent turn to finish. Transcript notice IDs suppress delivery retries after acceptance.

Each watch stops on its own when its PR merges or closes, on an explicit watcher Stop, or when it is unlinked. Every watch of a session stops on session Abort or Stop, a missing/archived/read-only session, a new request for a user response, 10 consecutive comment-only wakes, or 15 minutes without a successful read. End a waiting agent turn with `end_turn` and `awaiting: "nothing"` to keep watching.

Polling uses several GitHub requests per PR, including GraphQL for unresolved threads and required checks. Every wake can use agent tokens. This change does not add webhooks, auto-merge, a merge queue, or Actions job-log downloads. Failed-check output is optional bounded check annotations, labeled `logSource: "annotations"`.

## HTTP contract

Routes live on sessiond and pass through the existing local and machine-scoped `/api` prefixes. The daemon resolves the target repository from the session's project configuration or GitHub origin. A merge request's `repo` is a confirmation value, not a way to select another repository.

| Route | Request | Result |
| --- | --- | --- |
| `GET /github/pulls` | None. | A `links` catalog for session badges. |
| `GET /sessions/:id/pull-requests` | A `cwd` query. | `items`, oldest link first. Each item has `link` and `pull`; a failed read gives `pull: null` and `error`. |
| `PUT /sessions/:id/pull-requests` | `{cwd, number}`. | Add a link to an existing PR and return `{link, pull}`. An existing link is returned unchanged. |
| `GET /sessions/:id/pull-requests/:number` | A `cwd` query. | One linked PR: `{link, pull}`. |
| `DELETE /sessions/:id/pull-requests/:number` | A `cwd` query. | Remove the link and its watch; return the removed link. |
| `POST /sessions/:id/pull-requests/:number/watch` | `{cwd}`. | Start or retain that PR's watch and return the link. |
| `DELETE /sessions/:id/pull-requests/:number/watch` | A `cwd` query. | Stop that PR's watch without unlinking it. |
| `POST /sessions/:id/pull-requests/:number/merge` | `{cwd, repo, headSha, method}`. | Merge only after validating the confirmed head again. |

The list route reads every linked PR from GitHub, several requests each. Clients read it on demand, not on a timer.

A successful merge through this route also writes a `forgerie:pull-request` custom message into the session transcript, with `details.kind: "merged"`, the repository, number, head SHA, method, and base. It tells the agent the PR is merged and must not be merged or pushed again. It does not start an agent turn; during a run, Pi adds it when the turn ends. A failed note is logged and does not turn a completed merge into an error.

Use full session IDs. `method` is `rebase`, `squash`, or `merge`. The merge endpoint binds confirmation to the repository, PR number, and head SHA. It checks current PR state, completeness, reviews, mergeability, and CI. It then uses the existing merge implementation, which rechecks CI and submits the exact head SHA to GitHub. GitHub can still refuse under branch protection. The existing `github_write merge_pr` keeps its original gate.

`src/shared/pullRequests.ts` defines the wire schemas. Dates are absolute timestamps. Clients compute relative labels. `mergeability` is `clean`, `conflicting`, or `unknown`. `merge` gives `allowed` or `blocked` with a reason. Clients must not infer merge permission from zero checks or an unknown mergeability result.

The daemon publishes `session.pull-request` events when a link or watch changes, and `session.pull-request.unlinked` when a link is removed, on the session and global streams. Each event carries one link; a client keys links by session, repository, and number. The catalog and normal session list/status snapshots remain the recovery source after reconnect. `watchingPullRequest: true` means at least one of the session's PRs is watched. It tells a client to keep an idle watched session in Working rather than the inbox. Consuming this flag belongs to the frontend integration.

## Persistence and deployment

Sessiond owns `pull-requests.json` in the configured Forgerie data directory. It stores one record per session and PR: link, watch checkpoint, revision, and pending notice. The file is version 2. The daemon reads a version 1 file (one PR per session) unchanged and writes version 2 on the next change. A daemon from before this change refuses to start with a version 2 file; to roll back, restore a version 1 backup or keep one record per session. Atomic writes precede publication. A malformed file stops daemon startup rather than discarding live watches. Back up this file before manual repairs.

Stop invalidates in-flight reads. A notice already accepted by Pi can still finish its agent turn after watcher Stop. Stop prevents future watcher delivery; use session Abort to stop the current agent run.

Build and restart the local units after landing backend changes. A sessiond restart stops active agent runs, so check current activity before restarting. Restore the prior build and restart again to roll back; the PR state file remains on disk.
