# Pi Durable migration

Status: partial migration. Parent paths and shutdown pass their audited checks. Durable children, workflows, and startup recovery have focused tests. pi-subagents is no longer bundled, so no delegation path creates legacy children. The user authorized production deployment before all gates pass. This is not a completed migration.

## Accepted scope

The user selected Durable execution with SDK helpers retained. Forgerie must use Durable for every parent and delegated agent run. Keep coding-agent for resources, settings, authentication, model services, tools, extension hooks, and legacy JSONL readers. Do not construct an `AgentSession` or `Agent` for Forgerie execution.

Implement in `.worktree/pi-durable-migration`, created from `main` at `9fcdf56e`. Leave the unrelated `new-ui-mvp` worktree unchanged. The user subsequently requested immediate deployment of the partial implementation. Preserve rollback data, wait for active runs to finish, and verify the running build. The outstanding feature and recovery gates remain open.

## Implementation

Test counts in this table were checked at `0fce4220`.

| File | Responsibility | Verified scope |
| --- | --- | --- |
| `src/server/sessions/durableOwnership.ts` | Hold a nonblocking kernel lock before opening SQLite. Resolve directory and file symlinks. Reject hard-link aliases. Never unlink the lock file. | Three tests in `durableOwnership.test.ts` pass. They check exclusion, release, reopen, and aliases. |
| `src/server/sessions/durableJson.ts` | Convert SDK values to strict JSON. Preserve prototype keys as data. Reject unsupported values and cycles. | Six tests in `durableJson.test.ts` pass. |
| `src/server/sessions/durableSessionJournal.ts` | Import legacy context without executing it. Preserve an existing legacy file. Project native messages into SDK JSONL. | Six tests in `durableSessionJournal.test.ts` pass. They include projection repair, notifications, fork stamps, and branch selection. |
| `src/server/sessions/durableSdkTools.ts` | Use the same registry for direct and codemode calls. Forward SDK tool hooks and turn termination. | Read, QuickJS codemode, termination, tool selection, and override safety pass through the facade. Hosted codemode checks also pass. |
| `src/server/sessions/durableSdkPresentation.ts` | Use SDK prompt, template, and bash helpers without a legacy execution loop. | Facade tests exercise prompts and user bash. Upgrade checks remain. |
| `src/server/sessions/durableAgentSession.ts` | Adapt Durable execution to Forgerie's session interface and SDK extension contexts. | 22 tests in `durableAgentSession.test.ts` and nine in `durableAgentSession.thinking.test.ts` pass. Full compatibility remains unverified. |
| `src/server/sessions/durableSessionRuntime.ts` | Fork sessions and close outgoing journals without explicit cancellation. Construct a fork candidate before closing the outgoing session. | Default-runtime and interruption/reopen tests pass. Durable runtime fork and failed-candidate rollback tests remain. |
| `src/server/sessions/durableChildAgents.ts`, `durableChildRuntime.ts`, `durableChildHost.ts` | Host opt-in Durable children in the parent's storage. Apply agent files, tools, questions, worktrees, and completion reports. | 21 tests in `durableChildAgents.test.ts` pass. They include parallel recovery, lost-index recovery, accounting repair, and questions after restart. |
| `src/server/sessions/durableWorkflowRuns.ts` | Save workflow inputs, child results, user stops, and temporary proposals in Durable. | 21 tests in `workflowRuns.test.ts` and one in `durableWorkflowRuns.test.ts` pass. |
| `src/server/sessions/durableSessionRecovery.ts` | Discover unfinished tasks, submissions, and workflows at daemon startup. Reopen their parent sessions with at most four concurrent opens. | 14 discovery/orchestration tests and five production-service recovery tests pass. |

`defaultCreateAgentRuntime` uses the Durable facade and runtime in `src/server/sessions/piSessionService.ts`. This shipped in `2698b35d`. The production-factory integration test runs a configured provider, observes browser events, and checks its SQLite journal.

Durable children are opt-in through `durableChildren` (`f68f796d`). Workflows use the same storage (`e4e841ce`). Sessiond now starts recovery without a browser request (`29d69350`).

Forgerie no longer bundles pi-subagents, so its `subagent` tool and its non-Durable children are gone. `child_agent` is the only delegation path. A Pi profile that installs pi-subagents itself would bring the tool back; that is outside Forgerie's control.

Persistent data lives beside the session file at `.durable/<session-filename>/state.sqlite`. Before first import, the journal copies an existing file to `original.jsonl` with exclusive creation. A new Durable session has no legacy file to copy.

Import retains legacy data and projects each active SDK contribution as a separate native entry. Separate entries give native compaction usable cut points. Import does not replay historical tool calls.

Projection stamps contain both `forgerieDurableSessionId` and `forgerieDurableEntryId`. A fork can retain parent stamps, so a numeric native ID alone cannot identify a projected child entry.

The journal saves a user-only JSONL projection before the first provider request. SDK persistence normally waits for an assistant. Waiting would hide an interrupted first request from session discovery.

Parent replay is safe only for the original SDK `read` and `ls`, and for `child_agent`, `propose_workflow`, `workflow_finish`, and `workflow_stop`. The native tools use tested receipts to prevent duplicate effects on replay. SDK `grep` and `find` are unsafe because they can install binaries. All other parent tools and SDK overrides are unsafe. See [Parent tool replay](durable-tool-replay.md) for the policy and receipt tests (`abffd137`). These receipts do not prevent duplicates from new model requests.

## Cost and limits

SDK JSONL remains necessary for extension state, history, tree operations, and existing readers. Maintaining SQLite, projection, and a legacy backup increases disk use. No production-scale disk or throughput measurement exists yet.

The presentation adapter imports private SDK helpers. Pi packages are pinned to `1.1.0`. Upgrades must exercise those imports and all adapter checks. Durable's API is experimental.

Ownership uses `flock` and `cat`. Knip lists flock as an external host binary, not an npm dependency. The active local sessiond unit now includes `nixpkgs#util-linux` and `nixpkgs#coreutils` in its `nix shell` inputs. This was checked with `systemctl --user show` on 2026-10-12. Other deployments must supply both commands. Keep the old unit with the rollback files. The lock does not provide multi-machine ownership or preserve external processes after a crash.

The current facade does not yet preserve the full SDK lifecycle. In particular, `agent_before_settle`, boundary drafts, complete provider hooks, tree hooks, and compaction hooks need implementations and tests. Message-end hook timing also needs verification against committed history.

Manual compaction still needs `SessionCompactionQueue` to hold browser input. That queue saves request IDs in memory, not in Durable, until it drains. A crash can lose acknowledged held input. See Browser prompt request identity below.

Native automatic compaction is not yet projected into SDK context. Model and thinking selections now have reopen tests (`871d715f`). The hosted codemode test checks final progress ordering. Streaming snapshots, partial argument changes, broader event ordering, and slow-consumer replacement still need Durable integration checks. Service tests that inject fake runtimes do not prove this adapter behavior.

Durable coalesces rapid tool progress updates into the terminal commit. The SDK event adapter emits the committed result as a final progress update before tool completion. This prevents stale codemode progress. It adds one browser event per completed tool, without an extra database write. The hosted codemode test checks completed nested calls, event order, and history projection.

Extension command-context actions for new session, switch, and fork currently reject requests. They need host-owned implementations. Durable runtime fork now constructs its candidate before closing the outgoing session. Failed-candidate rollback still needs a Durable runtime test.

An in-memory SDK manager uses in-memory native storage. This has no restart recovery. Persisted parents and Durable children now have production-service recovery tests. Startup scans journals and unfinished child-run records, not the child live index. Discovery adds disk reads. Recovered runtimes use memory and can start provider requests without a browser connection. The concurrency bound limits opens, not the total number of recovered runtimes. Legacy pi-subagents recovery is not covered by this mechanism.

## Required acceptance before cutover

Audit date: 2026-10-12, at `57105685`. The audit now includes request-ID changes from #48 and the final replay policy from `abffd137` (#47). Verified means the required mechanism has a named passing check. Partial means only part of the gate has evidence. Pending means the audit has no acceptance check for that gate. A partial gate is not permission to cut over.

Test paths below are under `src/server/sessions/`, unless stated otherwise.

| Area | Required check | Status | Evidence and remaining checks |
| --- | --- | --- | --- |
| Parent execution | Replace `defaultCreateAgentRuntime` and every production legacy execution path. | Verified for parent paths. | `piSessionService.ts` uses `DurableSessionRuntime.open` and `DurableAgentSession.open` (`2698b35d`). `piSessionService.durable.test.ts`: “retries a dropped idle HTTP receipt with one run, user entry, and native journal” passes (`0fce4220`). Source inspection found no execution construction of `AgentSession` or `Agent` in `src/` or `extensions/`. Bundled pi-subagents still constructs SDK sessions in production. The all-execution requirement remains unmet; see Delegated execution below. |
| Delegated execution | Every delegation path runs Durable children. Prove no fallback creates legacy children. | Met by removal. pi-subagents is no longer bundled, so `child_agent` is the only delegation path. Fork context and detached runners were dropped, not migrated. | `durableChildAgents.test.ts`: “runs a child from a project agent file with its prompt and only its tools” passes (`f68f796d`). `bundledWebAccess.test.ts` checks that hosted sessions register no `subagent` tool. |
| Delegated recovery | Recover children and their output without duplicate launches, worktrees, or external effects. Restore parent ownership and completion delivery. | Partial. | `durableChildAgents.test.ts`: “runs three children in parallel and resumes each with one report after restart” (`e02d7e8e`), “recovers live child work from journals after the external child index is lost”, and “recovers a lost completion write from an unfinished checkpoint after the live index clears” (`29d69350`) pass. `child_agent` uses task-keyed spawn/send receipts and worktree allocation. `propose_workflow` and `workflow_stop` use task-keyed receipts; `workflow_finish` reuses its stored outcome. `durableParentToolReplay.test.ts`: “replays a spawn interrupted after worktree creation but before its child receipt” passes (`abffd137`). See [Parent tool replay](durable-tool-replay.md) for the receipt checks. They use journal close/reopen, not SIGKILL. Kill-window allocation, broader external-effect checks, and legacy recovery remain. |
| SDK compatibility | Run real bundled and configured extensions. Verify provider hooks, input, prompts, tools, nested calls, loadout restrictions, lifecycle, and resources. | Partial. | `durableAgentSession.test.ts`: “runs real QuickJS codemode through the same tool registry” passes. `piSessionService.codemode.acceptance.test.ts`: “offers codemode to the model and runs a script's calls as one transcript step” passes (`2698b35d`). Real configured extension/reload checks pass in `piSessionService.questionTools.acceptance.test.ts`. Provider, boundary, settle, tree, and compaction hook parity remains unverified. |
| Dialogs | Verify ask_user, browser extension dialogs, answering after reconnect, pending forms, and interruption between state declaration and tool-result commitment. | Partial. | `piSessionService.codemode.acceptance.test.ts`: “rebuilds an unanswered browser form after constructing a new daemon service” passes. `piSessionService.questionTools.acceptance.test.ts`: “preserves plugin confirmations and delivers their answers” passes. `durableChildAgents.test.ts`: “keeps one question across a restart, and an answer after it reaches the child” passes (`f68f796d`). Declaration/commit interruption and real browser reconnect remain. Extension dialogs close on daemon disposal; they are not Durable waits. |
| History | Verify model context, branches, fork IDs, labels, custom entries, compaction, archive, and deletion. Preserve original files. | Partial. | `durableSessionJournal.test.ts`: “imports history without executing it, preserves the original, and projects new messages once”, “does not let an inherited parent stamp hide a new fork message with the same native ID”, and “selects another legacy tree branch without replaying its tools” pass (`2698b35d`). Notification projection checks also pass (`9701a183`). Durable compaction, labels, full fork lifecycle, archive, and deletion checks remain. Tree/service tests with fake runtimes are not facade acceptance. |
| Reopen | Verify saved model, thinking, selected branch, custom state, and unfinished execution. | Partial. | `durableAgentSession.thinking.test.ts`: “saves initial HIGH thinking and preserves it across repeated reopens and a model change” passes (`871d715f`). `piSessionService.recovery.test.ts`: “resumes an interrupted parent without a browser request, another prompt, or a child index” passes (`29d69350`). Journal tests check custom entries and projection repair. `workflowRuns.test.ts`: “recovers a workflow waiting at a user stop without the live index or starting later work” passes. `durableAgentSession.test.ts`: “reuses an idle prompt after its receipt is lost, including after reopen” passes (`0fce4220`). Selected-branch reopen and full extension custom-state checks remain. |
| Shutdown | Replace daemon shutdown abort with native close. Retain abort for explicit Stop. | Verified. | `src/server/sessiond.ts` calls service disposal. `piSessionService.ts` disposes runtimes; `durableSessionRuntime.ts` closes the journal (`2698b35d`). `piSessionService.recovery.test.ts` checks interrupted-parent recovery and “keeps completed and explicitly stopped runs lazy after restart” (`29d69350`). Both pass. `durableChildAgents.test.ts` also checks child recovery after service disposal. This verifies native close versus explicit abort, not every signal/tool interruption window. |
| Crash | Kill the integrated daemon during generation, safe and unsafe tools, codemode, dialogs, and delegation. Verify deduplication and receipts. | Partial. Historical integrated child check only. | At `e02d7e8e`, `prototypes/durable-child-spike/sessiond-real.mjs` kills sessiond with SIGKILL during child bash. `sessiond-real-results.json` records “SIGKILL and automatic startup resume” as passing. Assertions check one child, the same conversation ID, one report, and one start-marker write. These files were removed in `8373535b`. This audit did not rerun that check. The current full crash matrix remains pending. Graceful-close tests are not kill tests. |
| Deployment | Audit active legacy work, preserve rollback data, build, and verify the running build. | Partial. | The audit's `npm run build` passes on Node 24. Read-only `systemctl --user show` checks found both local units active and the required lock packages in sessiond's command. `curl http://127.0.0.1:8504/` returned HTTP 200. Active legacy work, rollback data, and the running build identity were not checked. No restart or deployment was done in this audit. |
| Browser | Test reconnect and the four Galaxy Z Fold 8 postures in both color schemes. Read every capture. | Pending. | Request-ID retry tests now cover dropped receipts (`0fce4220`), not real browser reconnect or posture acceptance. No migration-specific reconnect/posture check was run in this audit. UI unit tests do not prove the eight captures. |

Archive ownership repair is a separate task. Do not run the repair script while developing this migration.

## Current verification

At `57105685`, the 2026-10-12 audit ran focused checks on Node 24:

| Check | Result |
| --- | --- |
| The 11 `durable*.test.ts` files and seven service files listed below | 205 tests passed across 18 files in 28.37 seconds. |
| `src/server/sessions/workflowRuns.test.ts` | 21 tests passed in 23.31 seconds. |
| `npm run verify` | Passed. Root: 2,046 tests passed, five skipped, across 223 files. UI: 1,565 tests passed, one skipped, across 164 files. Typecheck, lint, root/UI knip, UI gates, and UI build passed. |
| `npm run build` | Passed. The UI build reported large-chunk warnings. |

After rebasing onto `0fce4220`, the audit repeated these checks on Node 24:

| Check | Result |
| --- | --- |
| `durableAgentSession.test.ts`, `piSessionService.durable.test.ts`, `piSessionService.promptQueue.test.ts` | 72 tests passed across three files in 2.73 seconds. |
| `npm run verify` | Passed. Root: 2,060 tests passed, five skipped. UI: 1,565 tests passed, one skipped. Static checks and UI build also passed. |

After rebasing onto `abffd137`, the audit repeated these checks on Node 24:

| Check | Result |
| --- | --- |
| `durableParentToolReplay.test.ts`, `durableAgentSession.test.ts`, `durableSessionJournal.test.ts` | 48 tests passed across three files in 4.03 seconds. |
| `npm run verify` | Passed. Root: 2,084 tests passed, five skipped. UI: 1,572 tests passed, one skipped. Static checks and UI build also passed. |

The seven original focused service files were `piSessionService.durable.test.ts`, `piSessionService.recovery.test.ts`, `piSessionService.codemode.acceptance.test.ts`, `piSessionService.questionTools.acceptance.test.ts`, `piSessionService.extensionDialogs.test.ts`, `piSessionService.lifecycle.test.ts`, and `piSessionService.tree.test.ts`. The last three use fake runtimes for service behavior. They do not establish Durable facade parity.

Repeat the focused checks with:

```bash
nix shell nixpkgs#nodejs_24 -c npx vitest run \
  src/server/sessions/durable*.test.ts \
  src/server/sessions/piSessionService.durable.test.ts \
  src/server/sessions/piSessionService.recovery.test.ts \
  src/server/sessions/piSessionService.codemode.acceptance.test.ts \
  src/server/sessions/piSessionService.questionTools.acceptance.test.ts \
  src/server/sessions/piSessionService.extensionDialogs.test.ts \
  src/server/sessions/piSessionService.lifecycle.test.ts \
  src/server/sessions/piSessionService.tree.test.ts
nix shell nixpkgs#nodejs_24 -c npx vitest run src/server/sessions/workflowRuns.test.ts
```

Repeat full verification and build with:

```bash
nix shell nixpkgs#nodejs_24 -c npm run verify
nix shell nixpkgs#nodejs_24 -c npm run build
```

These results prove the checked mechanisms. They do not prove all-Durable delegation, full SDK parity, the integrated crash matrix, running-build identity, or browser posture acceptance.

## Browser prompt request identity (#48)

Browser chat sends and first prompts now allocate one opaque request ID per send.
A transport retry reuses the serialized body and ID. It makes at most two
attempts, with a 150 ms delay. The browser checks `/api/sessiond/runtime` before
retrying and requires the daemon's `session.prompt.requestIds` capability. Missing,
unavailable, or invalid runtime data disables automatic retries; an old daemon
can ignore the ID without receiving a second automatic send. Other mutations
are not retried. `/prompt` and
`/prompt-resource-command` validate the optional ID and carry it into Durable's
`conversation.submit`. Durable owns admitted request identity, including after
reopen. The service holds only in-flight receipts, including when the caller's
preflight deadline expires. Retries skip optimistic echoes and ask closure.
Matching text is not delivery identity: a deliberate repeated send gets a new ID.

The ID remains optional for server-owned `/skill:*` command forwarding,
`spawnSession`, and handoff continuation. These callers make new inputs rather
than transport retries. Callers without an ID do not get retry deduplication.
Extension commands or inputs handled before Durable submission are outside this
receipt contract. Browser shell and slash command endpoints keep their existing
no-retry policy.

Keep `SessionCompactionQueue`. In pi-durable 1.1.0, manual compaction summarizes
in the background while the conversation keeps working. The test
`Durable starts input while manual compaction is still summarizing` in
`src/server/sessions/durableAgentSession.test.ts` holds the
summary provider response, submits an input, and observes its user entry and
answer before releasing the summary. This differs from Forgerie's existing
hold-until-compaction-finishes contract. The service's compaction-held queue
now retains and checks request IDs and passes them to Durable when draining.
Mixed ID and no-ID inputs drain in admission order, not in lookup-completion
order. A browser preflight timeout cannot let the next queued input overtake
an admission that is still pending.
This queue remains in memory: input acknowledged behind compaction is still
not crash-durable until it reaches Durable. Removing this limit needs a separate
persisted ordering-boundary design, not deletion of the queue.
