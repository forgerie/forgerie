# Session-owned worktrees

## Decision

New browser-created sessions in Git projects use a fresh worktree by default. The draft creates nothing until the browser sends its first message and calls the session creation API. The user can choose an existing workspace for that session.

Agent-created sessions do not use this default. `spawn_session` and handoff keep their existing cwd inheritance. Their internal creation path does not call the browser coordinator.

Land is a local rebase and fast-forward. It does not push commits or create pull requests.

## API contract

Schemas and wire types live in `src/shared/sessionWorktree.ts`. Session projections and event unions live in `src/shared/apiTypes.ts`. The HTTP paths below use the `/api` prefix. The browser also retains the local-only `/api/machines/local` alias. Remote machine IDs are not supported. Sessiond registers the same paths without a prefix.

| Request | Result |
| --- | --- |
| `GET /sessions/worktree-options?cwd=<absolute path>` | `{kind:"git",repo,defaultBranch,defaultDestination:"fresh-worktree"}` or `{kind:"non-git"}`. |
| `POST /sessions` | Accepts `{cwd,startupToken?,modelSpec?,thinkingLevel?,destination?,setupId?}`. Returns `SessionInfo` with the actual new cwd and `worktree` for a fresh session. |
| `GET /sessions/worktrees?cwd=<absolute path>` | `{worktrees: SessionWorktreeRecord[]}`. The optional filter matches the main repo path or exact worktree path. Without it, returns the machine inventory. |
| `GET /sessions/worktrees/:worktreeId` | `{worktree: SessionWorktreeRecord,info: SessionWorktreeInfo}` with fresh Git status. |
| `POST /sessions/worktrees/:worktreeId/land` | `WorktreeActionResult`. No request body is required. |
| `POST /sessions/worktrees/:worktreeId/discard-preview` | `WorktreeDiscardPreview` with commit SHAs, subjects, dirty file paths, and `confirmationToken`. |
| `POST /sessions/worktrees/:worktreeId/discard` | Accepts `{confirmationToken}` from the preview. Returns `WorktreeActionResult`. |

`destination` is `{kind:"fresh-worktree"}` or `{kind:"existing-workspace"}`. Omission means fresh for Git and existing for non-Git. To opt out, send the existing workspace's cwd and `destination:{kind:"existing-workspace"}`. This is also required when the chosen workspace is already a linked worktree. Fresh always starts from the main repository's default branch, not the selected worktree's branch.

`setupId` retries an unowned failed setup in the same repository. Reuse it rather than allocating another worktree. `startupToken` correlates first-send progress before a session ID exists. Repeated fresh creation with the same token and repository returns the original owned session. Concurrent requests with the same cwd and token share one creation. The token does not change a session's model or cwd after creation. Use a new token for a new draft.

Malformed creation requests return HTTP 400 with `{error:string}`. An unknown worktree status request returns HTTP 404. Action precondition and operational errors return HTTP 409 with `{error:string}`. Structured domain outcomes return HTTP 200. Inspect `kind`; do not equate HTTP 200 with successful cleanup.

| Action result kind | Meaning and fields |
| --- | --- |
| `landed` | The default branch contains the result. Includes `sha` and `cleanup`. |
| `discarded` | The session is read-only. Includes `cleanup`. |
| `conflict` | Rebase conflicts were aborted. Includes `files`, `defaultBranch`, and a ready-to-send `prompt`. The user can offer that prompt to the agent through the existing session prompt API. |
| `blocked` | No merge occurred. Includes `reason` and `files`. Reasons include `worktree-dirty`, `main-dirty`, and `main-not-on-default-branch`. |
| `stale-preview` | The commits or dirty content changed since discard preview. Fetch another preview and ask for confirmation again. |

`cleanup.kind` is `pending`, `done`, or `failed`. A failed cleanup includes `error`. A landed merge is not undone because a cleanup hook failed. Retrying the same Land or Discard action retries cleanup from its durable receipt. Discard retry rechecks the confirmation token. If checkout contents or the default-branch tip changed, fetch another preview and ask for confirmation again. Cleanup also refuses to delete a branch whose tip changed after the discarded receipt.

## Setup and live status

Creation allocates `<main repo>/.worktrees/s-<8 characters>` and a short temporary branch. It uses the current local default-branch tip. The default branch comes from `origin/HEAD` when a corresponding local branch exists, then `init.defaultBranch`, then `main`, `master`, or the main checkout's branch. No network fetch occurs. An unborn repository without a commit cannot allocate a worktree.

The first allocation adds `/.worktrees/` to the common Git directory's `info/exclude`. It leaves `.gitignore` and existing exclusions unchanged. Legacy `.worktree/` checkouts keep their persisted paths. No folder or checkout moves automatically.

The server publishes `{type:"session.worktree",worktree:SessionWorktreeRecord}` on the global session event stream. After ownership exists, it also publishes on the owning session stream. After completion, all saved sessions in that worktree receive the event. Global first-send events carry the request's `startupToken` in the record. No setup log is appended to the Pi transcript.

`setup.phase` is `creating`, `hook`, `starting`, `done`, or `failed`. `setup.log` retains the last 64 KiB. A failed hook includes its `exitCode` and `error`. The hook's output streams while it runs. Periodic writes retain its log across daemon restart. A daemon restart during setup changes its phase to `failed`, preserving the saved log. A successful `done` setup can disappear from the frontend transcript view. A failed setup remains discoverable through the inventory even when Pi never started.

`SessionInfo.worktree` and `SessionStatus.worktree` contain the worktree ID, `owned`, repo path, cwd, branch, default branch, state, setup, and cleanup. For an active worktree, they also contain `ahead`, `behind`, and `dirtyFiles`. A Git read failure sets `statusError` instead of inventing zero counts. Sessiond reuses these three counts for 10 seconds per worktree: session lists, project views, heartbeats, and child summaries all ask for them, and each read runs six `git` child processes. A lifecycle change to the worktree record (rename, land, discard, cleanup) discards the held counts at once; a commit or file edit made inside the worktree can show up to 10 seconds late. A failed read is not held. Agent-created sessions sharing that cwd can receive the same information with `owned:false`. Only the owner exposes lifecycle actions in the UI.

The branch takes a slug of the generated session title. A taken name gains `-2`, `-3`, or the next available suffix. The rename occurs only once. A branch with an upstream, a matching remote-tracking branch, or unique commits reachable from a remote-tracking ref is not renamed. This uses local Git evidence; it cannot detect a push whose remote state has not reached local tracking refs. An interrupted rename has a durable intent that is reconciled at daemon startup.

### Project discovery caching

Sessiond caches Git repository detection and worktree listings by path for 10 seconds for project catalog display only. Concurrent project-view requests share the same Git read. `GitWorktreeDiscovery` defaults to no caching outside the daemon; its `cacheMs` and clock options make the window explicit.

Managed worktree creation (including child worktrees), removal, and branch rename clear project discovery immediately, before lifecycle notifications. Failed Git mutations also clear it because they can leave partial changes. Invalidation clears all project entries to cover main, linked, and symlink paths without extra Git processes. The next read of another project can therefore need Git again. Spawn authorization, session workspace membership, trigger validation, and project-tool target authorization use separate uncached discovery. The project catalog can still display an externally removed checkout while those checks deny it immediately. Tool checkout ownership and destructive lifecycle preconditions use fresh Git reads, not cached status summaries.

A worktree added, removed, or renamed outside Forgerie can appear up to 10 seconds late in the project view. The first request after expiry refreshes the facts; there is no background refresh. Rejected discovery reads are not cached.

## Declared workspace services

Managed worktrees can own development services through Process Compose. The declaration lives in `.forgerie/config.json` version 2. See [configuration](config.md#declared-workspace-services) for the file format and service environment.

The native Pi tool is `workspace_services`. Its actions are `status`, `logs`, `start`, `stop`, `restart`, and `wait`. It resolves the current worktree from the session's cwd. It cannot target another checkout. A start requires `approve=true` after user approval.

Start the project without a service name before individual controls. Repeating a whole-project start against a running instance does not execute another launch.

The web proxy exposes these paths with `/api`. Sessiond uses the paths without that prefix:

| Request | Contract |
| --- | --- |
| `GET /sessions/worktrees/:worktreeId/services` | Returns a services snapshot. |
| `POST /sessions/worktrees/:worktreeId/services` | Accepts `{action:"start"\|"stop"\|"restart",service?,approve?}`. A whole-project restart is refused. Stop and start to load changed configuration. |
| `GET /sessions/worktrees/:worktreeId/services/logs?service=web&lines=50` | Returns `{logs:string[],truncated:boolean}`. The maximum is 200 lines and 32 KiB of UTF-8 text. |
| `POST /sessions/worktrees/:worktreeId/services/wait` | Accepts `{timeoutMs,service?}`. The deadline is 1 through 120000 milliseconds. Returns `{kind:"ready"\|"timeout"\|"failed",snapshot}`. |

Malformed requests return HTTP 400. Missing worktrees, approval failures, and operational errors return HTTP 409 with `{error:string}`. Snapshot and wait outcomes return HTTP 200. Clients must read `kind`, not only the HTTP code. If the client disconnects, Forgerie cancels a readiness wait. Controls that Forgerie already admitted continue until they finish.

| Snapshot kind | Meaning |
| --- | --- |
| `not-configured` | No instance exists, and this worktree has no version 2 services declaration. |
| `stopped` | No instance started, or the recorded supervisor exited. |
| `running` | The control API responds. Individual processes can still be waiting, failed, or not ready. |
| `unavailable` | Forgerie cannot prove reachability or safe replacement. Start and cleanup refuse an unverified instance. |

A snapshot includes the worktree ID. Configured snapshots also include named ports and the retained data directory. A running snapshot includes process states, restart counts, and exit codes. Control tokens remain private. Logs are available through this API only while the supervisor responds.

Forgerie publishes `{type:"workspace.services",snapshot}` on the global stream when a snapshot changes. The native extension queues readiness and failure observations for the next Pi turn. It does not start a turn to poll services. Service variables apply to the declared processes, not to ordinary Pi shell commands.

New starts require completed setup and an active worktree without a lifecycle action. Land, Discard, and cleanup confirm service shutdown before the pre-remove hook. A missing socket does not prove shutdown. An uncertain supervisor keeps the checkout and reports a cleanup error. Cleanup retries repeat the shutdown check, including after a landed receipt.

Services must store retained data in `FORGERIE_STATE_DIR`. Shutdown preserves this directory outside the checkout. Worktree removal does not remove this data. Browser controls, preview routing, and automatic startup remain separate work.

## Repository hooks

Both hooks are optional executable files in the main repository:

| Hook | cwd | Argument and environment |
| --- | --- | --- |
| `.forgerie/hooks/worktree-post-create` | New worktree. | The worktree path is argument 1. `FORGERIE_WORKTREE_PATH` and `FORGERIE_REPO_PATH` are set. |
| `.forgerie/hooks/worktree-pre-remove` | Main checkout. | The worktree path is argument 1. The lifecycle runner sets the same environment variables. |

The post-create hook runs before Pi starts. A nonzero exit prevents startup and leaves a failed setup that the user can retry or discard. The pre-remove hook runs before Git removes the checkout. A nonzero exit prevents removal and leaves a cleanup failure. Hook processes have a 15-minute timeout. Git commands have a 2-minute timeout.

For a Node project, the post-create hook can install dependencies:

```sh
#!/bin/sh
set -eu
npm ci
```

This repository's executable post-create hook runs `npm ci` in the new worktree.
The root `prepare` script also installs `ui/` from its lockfile. With
`core.hooksPath=.githooks` (configured by root `prepare`), a manual
`git worktree add` runs that same hook through `.githooks/post-checkout`.
Only a null previous HEAD, checkout flag `1`, and a linked Git worktree admit
setup. Normal branch switches, file checkouts, and the main checkout do nothing.
Forgerie's managed creation defers setup to its lifecycle runner, which streams
logs and retains the 15-minute hook timeout instead of Git's 2-minute deadline.

A successful setup writes `forgerie-post-create.done` in that worktree's private
Git directory. Both entry points share this receipt and do not repeat the install.
It is a one-time setup receipt, not a dependency-health check. A failure leaves no
receipt and prints `npm ci` as the recovery command. Git can leave the new checkout
in place after a hook failure; from that worktree root, run `npm ci`, or rerun
`.forgerie/hooks/worktree-post-create "$PWD"` to also record successful setup.
Use Forgerie's setup retry for a failed managed allocation.

Manual creation now takes installation time and can require network access.
`git worktree add --no-checkout` does not run setup. After populating that checkout,
run `npm ci` from its root. Git hooks disabled by configuration also need this
explicit command. Separate installs cost disk space and setup time. Before staged validation,
`node scripts/verify-staged.mjs --check-dependencies` checks both local installs
and their executable tools. It accepts working directory links, but rejects
missing, cache-only, broken, or nested installs with an `npm ci` recovery command.

Make the hook executable. Prefer installing dependencies into the new worktree. Shared mutable `node_modules` can bring file collisions back.

Session-owned checkouts use Land or Discard, with transcript preservation, confirmation, and the pre-remove hook. There is no browser API to delete an arbitrary unowned worktree.

## Landing, discard, and archive safety

Lifecycle mutations serialize per main checkout. Before removal, the server gates new session input, refuses busy agents or managed processes, closes idle Pi runtimes, and saves transcripts outside the checkout. Land also refuses a dirty source worktree. The main checkout must be on the default branch. Dirty main files that overlap the merge's paths block Land; unrelated main edits remain intact.

Discard previews fingerprint HEAD, the default branch, the tracked diff, dirty paths, and their file content. Discard removes unlanded commits and dirty work. It also removes ignored files, including dependency and build directories. These ignored files do not count as dirty paths in the preview.

At daemon startup, a missing owner transcript in Pi's active directory does not prove setup failed. The server also checks the archive record and transcript header for the same session ID and worktree cwd. A matching archived transcript preserves ownership and the completed setup. The original transcript path remains the restore target. If neither location contains the owner transcript, startup clears ownership and offers setup retry.

Archive cleanup removes only a clean worktree whose commits are all contained in the default branch. It retains a worktree when any other session has a cwd at or below that path. This inventory includes archived sessions and delegated children hidden by inbox policy. The retained reason is exposed as `worktree.archiveCleanup`. Archive remains an archive operation even when cleanup is retained.

External Git commands are outside Forgerie's mutation queue. Do not switch branches, push, or edit the same checkout during Land or Discard. Git's own locks and precondition checks catch many races, but they do not provide a transaction across external commands and the ownership file.

## Automatic cleanup

Sessiond runs the cleanup job after child recovery at startup, then every five minutes. Concurrent requests share the current run. Shutdown cancels the timer and waits for that run.

The job visits only records in `session-worktrees.json` whose cleanup is not done. It never adopts or removes an unowned Git worktree. It uses persisted paths, including legacy `.worktree/` paths, without moving them.

A candidate must have completed setup, no live session use, no uncommitted or ignored files, and no commits outside the default branch. The job keeps a checkout switched or removed outside Forgerie. Git inspection failures keep the checkout.

Live use includes an unarchived session at or below the checkout path, even when idle or hidden from the inbox. A live parent keeps its child's or related checkout. Startup sessions, open runtimes, and the live-child recovery index also prevent cleanup. Archive the owning session before expecting cleanup. The job does not archive sessions itself.

The job gates new input, saves affected transcripts, and rechecks use, files, and branch ancestry before removal and after the pre-remove hook. After the hook and final checks pass, the job records the landed receipt before deletion. A failed hook keeps an active checkout writable and reports an error. A failure after the receipt leaves a read-only conversation and a cleanup error.

Ignored files count as `dirty` for automatic cleanup and archive cleanup. This includes dependency folders, build output, and private files. These files still do not count in ordinary `info.dirtyFiles`. This policy costs disk space. Explicit Land or confirmed Discard can remove ignored files as before.

These checks cover Forgerie's sessions and terminals. External programs do not share its input gate. The existing restriction on external edits during lifecycle actions also applies to cleanup.

| Reason | Why the job kept the checkout |
| --- | --- |
| `dirty` | Uncommitted or ignored files exist. |
| `unmerged` | The default branch does not contain every commit. |
| `in-use` | A session, parent, terminal, child recovery entry, or related checkout still uses it. |
| `setup-incomplete` | Setup or a recorded branch rename is unfinished. |
| `checkout-changed` | The persisted path or branch no longer matches Git. |
| `error` | Inspection, transcript preservation, or removal failed. `detail` gives the error. |

The read and run contracts are in [Child agents: cleanup API](child-agents.md#cleanup-api).

## Removed-workspace transcript decision

Removing a checkout must not remove its conversation.

Before Land, Discard, or archive cleanup removes a checkout, Forgerie copies every affected session transcript into `<data dir>/worktree-transcripts/<worktreeId>/`. It stores the original session identity and bounded listing metadata in `<data dir>/session-worktrees.json`. The transcript copy and metadata must succeed before the destructive step. The receipt records `state:{kind:"landed",sha,at}` or `state:{kind:"discarded",at}` before cleanup.

A completed-worktree session keeps its original ID and cwd. The server does not relocate it to the main checkout and does not run Pi there. Its saved transcript is read-only.

- `GET /sessions/all` and cwd-scoped listing retain the session even when its original store lived inside the removed checkout.
- The existing messages endpoint reads the saved transcript or its archived copy without creating an agent runtime.
- Status returns `readOnly:true`, an inert activity state, historical token/cost totals from saved assistant usage, and the worktree receipt.
- Stream snapshot returns `partial:null`. Prompt, reload, model changes, and runtime opening fail before Pi starts in the missing cwd.
- Archive and restore move the conversation between inbox groups. Restore keeps it read-only and restores its file outside the removed checkout. It does not restore the worktree.
- Deleting an archived conversation also removes its saved transcript metadata, so it does not reappear in the inbox.

The frontend must bypass the old missing-workspace row disable rule for these receipts. It can read the conversation without selecting a live workspace or exposing a writable composer. Show `landed on <default branch> at <sha>` or `discarded`, not an actionable missing-directory error. Starting new work from that conversation requires a new session.

This decision costs an additional transcript copy per affected session. It avoids executing tools in the wrong repository and remains readable after sessiond restart.

## Running-instance verification

After deployment, run:

```sh
./scripts/verify-session-worktrees.py --out /tmp/session-worktrees-live.json
```

The script creates a disposable Git repository, sends one short model prompt per test conversation to make Pi persist its transcript, runs a shell command, then checks Land, confirmed Discard, archive cleanup, removed-checkout reads, and rejected prompts. It sends three short prompts with the profile's default model. Automatic title generation can add model requests. Shell-only Pi sessions remain transient. It deletes only its completed test conversations. It keeps the disposable main repository and writes the results to the requested file. An interrupted or failed case can leave its test checkout for inspection.

## Frontend acceptance

The backend supplies the capabilities. The frontend session owns presentation and first-send draft state. Fix parking-lot item `01M1CS6D1HSETRY10K1541VNB7` first, so destination choice stays reachable at 475 × 638. Then add the default destination, setup card, branch chip and inbox counts, Land/Discard confirms, conflict prompt offer, and readable completed-session state.

Use the current session-header worktree controls in `ui/`. The retired Lit composer is not an implementation target. Add no toolbar or width breakpoint inside the 475–932 px posture range. Capture 704 × 783, 932 × 553, 475 × 638, and 711 × 374 in both light and dark with `scripts/capture-postures.mjs`, and read all PNGs. Captures do not prove physical-device acceptance.
