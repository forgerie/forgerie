# Pi Durable migration

Status: partial migration. The user authorized production deployment before the remaining migration gates pass. This is not a completed migration.

## Accepted scope

The user selected Durable execution with SDK helpers retained. Forgerie must use Durable for every parent and delegated agent run. Keep coding-agent for resources, settings, authentication, model services, tools, extension hooks, and legacy JSONL readers. Do not construct an `AgentSession` or `Agent` for Forgerie execution.

Implement in `.worktree/pi-durable-migration`, created from `main` at `9fcdf56e`. Leave the unrelated `new-ui-mvp` worktree unchanged. The user subsequently requested immediate deployment of the partial implementation. Preserve rollback data, wait for active runs to finish, and verify the running build. The outstanding feature and recovery gates remain open.

## Implementation

| File | Responsibility | Verified scope |
| --- | --- | --- |
| `src/server/sessions/durableOwnership.ts` | Hold a nonblocking kernel lock before opening SQLite. Resolve directory and file symlinks. Reject hard-link aliases. Never unlink the lock file. | Ownership exclusion, release, reopen, and aliases pass. |
| `src/server/sessions/durableJson.ts` | Convert SDK values to strict JSON. Preserve prototype keys as data. Reject unsupported values and cycles. | Six focused tests pass. |
| `src/server/sessions/durableSessionJournal.ts` | Import legacy context without executing it. Preserve an existing legacy file. Project native messages into SDK JSONL. | Five focused tests pass. |
| `src/server/sessions/durableSdkTools.ts` | Use the same registry for direct and codemode calls. Forward SDK tool hooks and turn termination. | Read, QuickJS codemode, termination, tool selection, and override safety pass through the facade. |
| `src/server/sessions/durableSdkPresentation.ts` | Use SDK prompt, template, and bash helpers without a legacy execution loop. | Prompt construction is exercised by facade tests. Upgrade and bash cases remain. |
| `src/server/sessions/durableAgentSession.ts` | Adapt Durable execution to Forgerie's session interface and SDK extension contexts. | Seven focused tests pass. Full compatibility remains unverified. |
| `src/server/sessions/durableSessionRuntime.ts` | Replace sessions and close outgoing journals without explicit cancellation. | Draft. Typecheck passes. Replacement, fork, and rollback tests remain. |

The migration branch now wires `defaultCreateAgentRuntime` to the Durable facade and runtime. One service integration test uses the real default factory, runs a configured provider, observes browser events, and verifies its SQLite journal. Production remains unchanged. Delegated factories still need migration, so this branch does not yet meet the all-execution requirement.

Persistent data lives beside the session file at `.durable/<session-filename>/state.sqlite`. Before first import, the journal copies an existing file to `original.jsonl` with exclusive creation. A new Durable session has no legacy file to copy.

Import retains legacy data and projects each active SDK contribution as a separate native entry. Separate entries give native compaction usable cut points. Import does not replay historical tool calls.

Projection stamps contain both `forgerieDurableSessionId` and `forgerieDurableEntryId`. A fork can retain parent stamps, so a numeric native ID alone cannot identify a projected child entry.

The journal saves a user-only JSONL projection before the first provider request. SDK persistence normally waits for an assistant. Waiting would hide an interrupted first request from session discovery.

Only original SDK read, grep, find, and ls implementations receive safe replay. An override named read is unsafe. Codemode and tools with external effects remain unsafe. This prevents automatic replay, not duplicates from new model requests.

## Cost and limits

SDK JSONL remains necessary for extension state, history, tree operations, and existing readers. Maintaining SQLite, projection, and a legacy backup increases disk use. No production-scale disk or throughput measurement exists yet.

The presentation adapter imports private SDK helpers. Pi packages are pinned to `1.1.0`. Upgrades must exercise those imports and all adapter checks. Durable's API is experimental.

Ownership uses `flock` and `cat`. Knip lists flock as an external host binary, not an npm dependency. On this host both commands resolve under `/run/current-system/sw/bin`, which the local units include in PATH. When deploying, add `nixpkgs#util-linux` and `nixpkgs#coreutils` to the session daemon's existing `nix shell` inputs so the dependency does not rely on host packages. Add those inputs during the user-authorized partial cutover. Keep the old unit with the rollback files. The lock does not provide multi-machine ownership or preserve external processes after a crash.

The current facade does not yet preserve the full SDK lifecycle. In particular, `agent_before_settle`, boundary drafts, complete provider hooks, tree hooks, and compaction hooks need implementations and tests. Message-end hook timing also needs verification against committed history.

Native automatic compaction is not yet projected into SDK context. Model and thinking state need reopen checks. Streaming snapshots, partial argument changes, event ordering, and slow-consumer replacement need integration checks.

Durable coalesces rapid tool progress updates into the terminal commit. The SDK event adapter emits the committed result as a final progress update before tool completion. This prevents stale codemode progress. It adds one browser event per completed tool, without an extra database write. The hosted codemode test checks completed nested calls, event order, and history projection.

Extension command-context actions for new session, switch, and fork currently reject requests. They need host-owned implementations. Runtime replacement must keep the outgoing session usable when candidate construction fails.

An in-memory SDK manager currently uses in-memory native storage. This has no restart recovery. Production parent and delegated persistence must be checked explicitly.

## Required acceptance before cutover

| Area | Required check | Status |
| --- | --- | --- |
| Parent execution | Replace `defaultCreateAgentRuntime` and every production legacy execution path. | Default parent factory switched. One integration test passes. Remaining execution paths need an audit. |
| Delegated execution | Inject Durable factories into unpatched pi-subagents, including detached runners and fork context. Prove no fallback creates legacy children. | Pending. |
| Delegated recovery | Recover children and their output without duplicate launches, worktrees, or external effects. Restore parent ownership and completion delivery. | Pending. |
| SDK compatibility | Run real bundled and configured extensions. Verify provider hooks, input, prompts, tools, nested calls, loadout restrictions, lifecycle, and resources. | Partial focused checks only. |
| Dialogs | Verify ask_user, browser extension dialogs, answering after reconnect, pending forms, and interruption between state declaration and tool-result commitment. | Pending. |
| History | Verify model context, branches, fork IDs, labels, custom entries, compaction, archive, and deletion. Preserve original files. | Import and basic projection checks pass. Full lifecycle pending. |
| Reopen | Verify saved model, thinking, selected branch, custom state, and unfinished execution. | Journal reopen and projection repair pass. Service recovery pending. |
| Shutdown | Replace daemon shutdown abort with native close. Retain abort for explicit Stop. | Service disposal now closes runtimes without calling abort. Lifecycle tests pass. Integrated interruption and reopen remain pending. |
| Crash | Kill the integrated daemon during generation, safe and unsafe tools, codemode, dialogs, and delegation. Verify deduplication and receipts. | Earlier standalone feasibility checks are not integration acceptance. |
| Deployment | Audit active legacy work, preserve rollback data, build, and verify the running build. | User authorized partial cutover. Production build passes. Backup, restart, and live verification pending. |
| Browser | Test reconnect and the four Galaxy Z Fold 8 postures in both color schemes. Read every capture. | Pending. |

Archive ownership repair is a separate task. Do not run the repair script while developing this migration.

## Current verification

Full verification passes: typecheck, lint, knip, and 5,171 tests across 506 files. Four tests are skipped. Managed run `durable-migration-verify-5` (`proc_0681`) exited with code 0 after 137 seconds.

The earlier full test run failed one codemode progress test. Both nested tools completed, but the last progress update stayed stale. The adapter now emits the committed final progress before tool completion. The acceptance test verifies completed nested calls, event order, and history projection.

Repeat full verification with:

```bash
nix shell nixpkgs#nodejs_24 -c npm run verify
```

This result proves the checked mechanisms. It does not prove feature parity, delegated execution, integrated restart recovery, or production readiness.

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
`Durable starts input while manual compaction is still summarizing` holds the
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
