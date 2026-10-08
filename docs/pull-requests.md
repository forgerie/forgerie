# Pull request backend

Forgerie's GitHub App reads PR data and links a PR to the session that created it. The MVP PR UI remains a separate fixture-only frontend until it uses these endpoints. The Lit frontend does not gain a PR panel in this change.

## Agent tools

`github_write create_pr` saves the session link after GitHub creates the PR. A failed link write reports the created URL. Do not create another PR to repair a failed link.

Use `github_watch` with `action: "start"` only when the user asks to watch a PR. An optional `number` links an existing PR in the session's own repository. Use `action: "stop"` when handing work back to the user.

The watcher polls once a minute. It reports a newly failed or cancelled check, all required checks passing, another author's comment or review, or a new conflict. If GitHub marks no checks required, passing news requires every observed check to pass. Zero checks never count as passing. A new head or a failed rerun can produce another failure report.

The watcher excludes comments from Forgerie's GitHub App account. It retains the existing author-trust rule before sending external text to an agent. Notifications contain fenced JSON data and do not authorize merges, pushes, or following external instructions.

A busy session's news stays in the durable outbox. The daemon delivers it when the session becomes idle. Polling does not wait for the resulting agent turn to finish. Transcript notice IDs suppress delivery retries after acceptance.

Watching stops on merge or close, an explicit watcher Stop, session Abort or Stop, a missing/archived/read-only session, a new request for a user response, 10 consecutive comment-only wakes, or 15 minutes without a successful read. End a waiting agent turn with `end_turn` and `awaiting: "nothing"` to keep watching.

Polling uses several GitHub requests per PR, including GraphQL for unresolved threads and required checks. Every wake can use agent tokens. This change does not add webhooks, auto-merge, a merge queue, or Actions job-log downloads. Failed-check output is optional bounded check annotations, labeled `logSource: "annotations"`.

## HTTP contract

Routes live on sessiond and pass through the existing local and machine-scoped `/api` prefixes. The daemon resolves the target repository from the session's project configuration or GitHub origin. A merge request's `repo` is a confirmation value, not a way to select another repository.

| Route | Request | Result |
| --- | --- | --- |
| `GET /github/pulls` | None. | A `links` catalog for session badges. |
| `GET /sessions/:id/pull-request` | A `cwd` query. | `link` and `pull`, each nullable when no link exists. |
| `PUT /sessions/:id/pull-request` | `{cwd, number}`. | Link an existing PR and return its snapshot. |
| `POST /sessions/:id/pull-request/watch` | `{cwd, number?}`. | Start or retain the watch and return the link. |
| `DELETE /sessions/:id/pull-request/watch` | A `cwd` query. | Stop without unlinking the PR. |
| `POST /sessions/:id/pull-request/merge` | `{cwd, repo, number, headSha, method}`. | Merge only after validating the confirmed head again. |

Use full session IDs. `method` is `rebase`, `squash`, or `merge`. The merge endpoint binds confirmation to the repository, PR number, and head SHA. It checks current PR state, completeness, reviews, mergeability, and CI. It then uses the existing merge implementation, which rechecks CI and submits the exact head SHA to GitHub. GitHub can still refuse under branch protection. The existing `github_write merge_pr` keeps its original gate.

`src/shared/pullRequests.ts` defines the wire schemas. Dates are absolute timestamps. Clients compute relative labels. `mergeability` is `clean`, `conflicting`, or `unknown`. `merge` gives `allowed` or `blocked` with a reason. Clients must not infer merge permission from zero checks or an unknown mergeability result.

The daemon publishes `session.pull-request` events on the session and global streams. The catalog and normal session list/status snapshots remain the recovery source after reconnect. `watchingPullRequest: true` tells a client to keep an idle watched session in Working rather than the inbox. Consuming this flag belongs to the frontend integration.

## Persistence and deployment

Sessiond owns `pull-requests.json` in the configured Forgerie data directory. It stores links, watch checkpoints, revisions, and pending notices. Atomic writes precede publication. A malformed file stops daemon startup rather than discarding live watches. Back up this file before manual repairs.

Stop invalidates in-flight reads. A notice already accepted by Pi can still finish its agent turn after watcher Stop. Stop prevents future watcher delivery; use session Abort to stop the current agent run.

Build and restart the local units after landing backend changes. A sessiond restart stops active agent runs, so check current activity before restarting. Restore the prior build and restart again to roll back; the PR state file remains on disk.
