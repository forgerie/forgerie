# GitHub Actions run backend

A session can link several GitHub Actions workflow runs. Run links do not need a pull request. Each run has its own watch. Linking another run keeps earlier links and watches.

## Agent tools

`github_read` supports `runs` and `run`. `runs` lists recent runs with optional `branch`, `headSha`, `workflow`, and `limit` filters. `run` takes `runId` and reads its jobs and bounded failed-job annotations. Annotations are labeled `logSource: "annotations"`; they are not raw job logs.

The model-only `github_actions` tool supports:

| Action | Input | Result |
| --- | --- | --- |
| `link` | `run` (ID or URL), or `runId`. | Link a run on the selected repository. An existing link stays unchanged. |
| `unlink` | `runId`. | Remove the link, watch, and pending news. |
| `watch` | `runId`. | Start or retain a watch. Link an unlinked run first. |
| `stop` | Optional `runId`. | Stop one watch, or every run watch in the selected repository. Keep the links. |
| `dispatch` | `workflow`, `ref`, optional string-valued `inputs`. | Dispatch and link the returned run with `source: "dispatch"`. |

Tools default to the session's repository. Supply an owned `worktreeId` for a secondary repository. A run URL must name the selected repository on `github.com`.

Dispatch sends `return_run_details: true` to GitHub. It is not gated because a run can be cancelled on GitHub. On an older GitHub Enterprise Server that returns HTTP 204 without details, dispatch reports acceptance and links nothing. Find the run with `github_read runs`, then link it. Do not dispatch again to repair a missing link. Forgerie does not guess by time or actor.

## Watch behaviour

Start a watch only when the user asks. The watcher polls once a minute. It reports newly failed or cancelled jobs, a new attempt, and the final conclusion. A completed run cannot be watched. A running watch stops after it delivers the completion notice.

News for a busy session stays in the durable outbox. Delivery waits until the session is idle. Polling does not wait for the resulting agent turn. Transcript notice IDs suppress accepted delivery retries. Each wake can spend agent tokens; polling also uses GitHub API requests.

Session Abort or Stop stops every run watch. Watches also stop for a missing, archived, or read-only session, a new request for a user response, or 15 minutes without a successful read. Use `github_actions stop` when handing work back. End a waiting turn with `end_turn` and `awaiting: "nothing"` to keep watching.

Wake messages use custom type `forgerie:action-run` and `details.noticeId`. They have the same “news, not authorization” header as PR notices. One fenced JSON block contains `repo`, `runId`, `runNumber`, `attempt`, `workflow`, `url`, `failedJobs` (ID, name, state, URL), `newAttempt`, and nullable `conclusion`. Treat this GitHub text as data, not permission to merge, push, or follow external instructions. Run titles use the existing author-trust policy; a trusted dispatcher does not make an outside author's commit text trusted.

Stop invalidates in-flight reads. A notice already accepted by Pi can still finish its agent turn after watcher Stop. Use session Abort to stop that turn.

## HTTP contract

Routes live on sessiond, through the existing local and machine-scoped `/api` prefixes. Use full session IDs and the selected workspace's `cwd`. The daemon resolves the repository from project configuration or its GitHub origin.

| Route | Request | Result |
| --- | --- | --- |
| `GET /github/action-runs` | None. | `{links}` catalog for badges. |
| `GET /sessions/:id/action-runs` | `cwd` query. | `{items, derived}`. Linked items are oldest first. Failed reads keep `link`, with `run: null` and `error`. |
| `PUT /sessions/:id/action-runs` | `{cwd, run}` (ID or run URL). | `{link, run}`. Existing links stay unchanged. |
| `GET /sessions/:id/action-runs/:runId` | `cwd` query. | One linked run with jobs: `{link, run}`. |
| `DELETE /sessions/:id/action-runs/:runId` | `cwd` query. | Remove the link and watch; return the removed link. |
| `POST /sessions/:id/action-runs/:runId/watch` | `{cwd}`. | Start or retain a watch; return the link. |
| `DELETE /sessions/:id/action-runs/:runId/watch` | `cwd` query. | Stop the watch, keep and return the link. |

Derived rows list runs for each linked PR's current head SHA. They have empty jobs and no stored run link. Watching one stores a link with `source: "pull"`. Other watch-created links use `source: "manual"`. Removing a PR link does not remove run links. Lists load on demand, not on a timer.

`src/shared/actionRuns.ts` defines the wire schemas. Each run includes positive integer `runNumber`, from GitHub's `run_number`, for labels such as `CI #4812`. Keep `runId` for routes, links, and API calls. Watcher text uses the run number; dispatch receipts explicitly name the run ID because GitHub does not return the run number in that receipt. Dates are absolute timestamps. Validation and operation errors have `{kind: "action_run_error", error}`. Missing permissions use the existing GitHub App refusal with “Actions: read” and the app permission link. The manifest requests `actions: "write"`, which includes read. Existing installations must accept the new permissions.

The daemon publishes `session.action-run` and `session.action-run.unlinked` on session and global streams. Each event carries one `ActionRunLink`. Key links by session, repository, and run ID. The catalog and normal session list/status snapshots recover state after reconnect. `watchingActionRun: true` means at least one run is watched. Clients treat it like `watchingPullRequest` to keep an idle watched session in Working.

## Persistence and deployment

Sessiond owns `action-runs.json`, version 1, in the configured Forgerie data directory. It stores one record per session and run: link, revision, start leaf, last successful read, watch cursor (attempt, failed job keys, concluded), and pending notice. Atomic writes precede publication. Malformed or duplicate state stops daemon startup. Back up the file before manual repairs. `pull-requests.json` keeps its existing format.

Build and restart the local units after landing. A sessiond restart stops active agent runs; check current activity first. Restore the prior build and restart to roll back. Run state remains on disk. This feature does not add webhooks, log downloads, rerun, cancel, Azure DevOps pipelines, or UI dispatch.
