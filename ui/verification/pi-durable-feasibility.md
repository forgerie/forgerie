# Can Forgerie switch to Pi Durable?

Date: 2026-10-08.

## Answer

I found no fundamental technical reason that prevents the switch. Pi Durable can supply Forgerie's agent execution and restart recovery. It cannot replace the current SDK with a dependency-name change while keeping every existing feature unchanged.

This conclusion is an engineering inference from published source and 11 passing targeted checks. Full Forgerie compatibility is not verified. The largest integration problem is `pi-subagents`, not model access, browser streaming, or compaction.

No production dependencies, session records, or services changed. The archive ownership fix at `9fcdf56e` remains a separate, pending deployment task from the source session.

## What I checked

The npm registry returned `1.1.0` as the latest release for both `@earendil-works/pi-durable` and `@earendil-works/pi-coding-agent`. The releases were published on 2026-10-07. I downloaded their published packages and inspected their README, declarations, and JavaScript implementations.

I compared them with the production backend at `/home/simonwjackson/code/sandbox/forgerie`, commit `9fcdf56e3232881a593c799502fe1942b65f71c2`. Forgerie's installed coding-agent SDK is `1.0.4`. It bundles `pi-subagents` `0.76.1` and patched `@aliou/pi-processes`.

The executable checks use Durable `1.1.0` and coding-agent `1.1.0`, with a locked standalone dependency set. They do not certify compatibility between Durable `1.1.0` and Forgerie's currently installed SDK `1.0.4`.

Primary package sources:

- [Durable 1.1.0 README](https://unpkg.com/@earendil-works/pi-durable@1.1.0/README.md) explains recovery, storage ownership, events, compaction, and children.
- [Durable 1.1.0 changelog](https://unpkg.com/@earendil-works/pi-durable@1.1.0/CHANGELOG.md) records breaking changes and context-cache retention.
- [Durable tool and conversation contracts](https://unpkg.com/@earendil-works/pi-durable@1.1.0/dist/harness/types.d.ts) define the replacement integration contract.
- [Coding-agent 1.1.0 dependencies](https://unpkg.com/@earendil-works/pi-coding-agent@1.1.0/package.json) do not include Pi Durable. An SDK upgrade alone does not make Forgerie durable.

## Compatibility findings

| Area | Finding | Required work or remaining limit |
|---|---|---|
| Agent execution | Durable admits inputs, runs model/tool tasks, and persists their checkpoints. | Replace Forgerie's `AgentSession` orchestration. Existing active runs have no Durable checkpoints to resume retroactively. |
| Models and credentials | Coding-agent `ModelRuntime` implements the `Models` interface Durable accepts. The executable check uses that real implementation for generation. | The SDK can remain for reusable services. Real account login, token refresh, custom provider extensions, and virtual-model policy still need integration tests. |
| Browser streaming | `watchEvents()` supplies snapshots, message progress, tool progress, queues, and usage. Reopen supplies a current transcript snapshot. | Event payloads differ. For example, `message_end` carries `entry`, not the current coding-agent `message`. Slow-consumer overflow produces a snapshot, so transport must support replacement state. |
| Compaction | Manual compaction passed. Durable also implements background, threshold, and overflow compaction. | Map Forgerie's existing queue and presentation contracts. Automatic/background races were inspected, not exercised in this audit. |
| Custom state and questions | Durable documents and entries can hold response requests, asks, delivery receipts, and GitHub outbox state. A turn-ending tool committed reply state before termination in the test. | Port current custom-entry projections and make external side effects idempotent by call/request identity. Durable does not automatically resume a JavaScript Promise awaiting a browser dialog. |
| History and trees | Durable history forks passed. It exposes context at an earlier entry and immutable forked conversations. | It does not expose coding-agent's same-session `navigateTree()` or movable leaf API. Preserve Forgerie's tree behavior through explicit identity/history mapping rather than silently removing it. |
| Existing sessions | Durable entries can carry model messages and application data. Its JSONL backend stores Durable records, not coding-agent session files. | Build and verify a legacy import/projection path, including branch summaries, custom messages, response state, attachments, and old IDs. Existing archive and scanner code is file-based. |
| `pi-subagents` | The bundled extension uses coding-agent lifecycle hooks and session managers. Its child factory explicitly calls `createAgentSession()`. Fork mode opens and rewrites Pi JSONL files. | Native Durable children are supported and passed a small test, but they are not a drop-in replacement for this package's workflows, controls, policy, missions, or result protocol. Keeping unchanged legacy children leaves their runs non-durable. |
| Managed processes | `pi-processes` uses coding-agent hooks and an event bus. Its shutdown hook calls `manager.killAll()`. Forgerie's process panel uses a bridge to that bus. | Adapt the integration or move process ownership outside the replaced runtime. Durable checkpoints do not preserve an OS process, terminal, open pipe, or stdin state. |
| Coding tools and images | Native Durable `read` rejects images. A wrapper around coding-agent's real read tool passed a PNG through Durable model context. | Native image reading is a feature gap, not a fundamental blocker. Keep or implement an image-capable tool. Check all other tool contracts and error/truncation behavior. |
| Codemode | `pi-codemode` is a standalone QuickJS package. It ran inside a Durable tool and returned `42`. | Port the SDK extension's registry, exposure rules, nested hooks, structured output, and UI details. A script with writes must not become replay-safe merely because its wrapper uses Durable. |
| Archive and permanent deletion | The public Durable transaction API can append/fork conversations and retire documents. It has no conversation-deletion operation. | Archive visibility can be application state. Physical deletion and fork dependencies require a storage lifecycle design or upstream API support. Hiding a conversation is not deletion. |
| Skills, prompts, settings, and extension UI | Durable extensions use named tool/section/hook/task bundles. Coding-agent extensions use `ExtensionAPI`, session lifecycle callbacks, commands, and `ctx.ui`. | Resource loading can remain SDK-backed, but runtime bindings need an adapter. There is no published drop-in loader for the current extension ecosystem. Terminal `pi` also remains a legacy session-file consumer. |
| Ownership and storage | Durable explicitly requires one owning process per storage. Its Node SQLite implementation uses WAL and `synchronous = NORMAL`. | Enforce a host lock before opening storage. SQL transaction serialization is not an agent-owner lease. Process-crash recovery does not imply machine failover; the latest SQLite commit can be lost on power failure. |

### The biggest obstacle: preserving delegated agents

The production runtime loads the bundled package in `src/server/sessions/piSessionService.ts`, through `createAgentSessionServices()` and `createAgentSessionFromServices()`.

I inspected these installed files directly:

- `node_modules/pi-subagents/src/extension/index.js` registers coding-agent events such as `session_start`, `agent_end`, and `session_before_compact`.
- `node_modules/pi-subagents/src/runs/shared/child-session.js` creates a coding-agent `SessionManager` and calls `createAgentSession()`.
- `node_modules/pi-subagents/src/shared/fork-context.js` calls `SessionManager.open()` and `createBranchedSession()` on persisted JSONL files.

Durable's owned-conversation task model provides the necessary execution mechanism. The missing work is compatibility with this package's behavior and persisted run records. Forgerie's standing rule ships `pi-subagents` unpatched. A migration therefore needs an upstream-compatible route or an explicit decision about that product constraint.

A compatibility layer can retain legacy children, but that does not meet the stronger requirement that delegated runs survive daemon restarts. I have not implemented or verified a complete compatibility layer.

### Shutdown must pause, not abort

Forgerie's `src/server/sessiond.ts` calls `sessions.dispose()` on SIGTERM. `PiSessionService.dispose()` calls `abortSessionOperations()` before runtime disposal.

Durable distinguishes closing from aborting. Its `Harness.beforeClose()` joins interrupted invocations without writing task outcomes. Reopen returns surviving running tasks to pending. `Conversation.abort()` instead records cancellation and withdraws queued inputs.

If migration maps current shutdown to Durable abort, the restart will still cancel the work. The new integration must use close/resume semantics for service replacement and preserve abort for an explicit stop request.

Sources: [Harness implementation](https://unpkg.com/@earendil-works/pi-durable@1.1.0/dist/harness/harness.js) and [scheduler implementation](https://unpkg.com/@earendil-works/pi-durable@1.1.0/dist/harness/scheduler.js).

### Replay is not exactly-once execution

Two new process-level tests used SIGKILL against Durable 1.1.0:

| Interrupted tool | Result after reopening | Side-effect result |
|---|---|---|
| Explicitly replay-safe tool | The same stored input completes. The tool runs a second attempt. | The test tool performs no business side effect. |
| Unsafe tool after a committed external effect | The same stored input completes. The tool is not rerun. Its result says it was interrupted. | The append-only effect log contains one line. |

This prevents automatic replay of the unsafe tool. It does not prevent a model from issuing a new call that repeats the external operation. Tools need idempotency and receipts where repetition is unacceptable.

[Tool recovery source](https://unpkg.com/@earendil-works/pi-durable@1.1.0/dist/harness/tool.js) requires both the saved and current policies to say `safe`. The default is `unsafe`. Even the native read implementation does not declare a safe replay policy. Every offered tool requires review, including codemode and extensions.

## Executable evidence

`verification/pi-durable-audit/` contains a locked standalone experiment, not production integration.

Run it without credentials:

```bash
cd verification/pi-durable-audit
nix shell nixpkgs#nodejs_24 -c npm ci --ignore-scripts
./smoke.mjs
./crash-test.mjs
```

Nine smoke checks passed: SDK model-runtime reuse, history fork, image adapter, codemode reuse, owned child, termination with custom state, manual compaction, event streaming, and SQLite reopen with request deduplication and reconnect snapshot.

Two SIGKILL checks passed: safe and unsafe tool recovery. `smoke-results.json` and `crash-results.json` capture the receipts. Tests use the official configurable `fauxProvider`, real SQLite, real subprocesses, the real SDK read tool, and the real QuickJS sandbox. They do not call production APIs or read production credentials.

The earlier prototype at backend commit `922b7dcc` tested 1.0.4 with a real model and demonstrated conflicting owners. Its README remains evidence for that version; it is not proof of full integration.

The UI worktree's `npm run verify` also passed build, lint, and all 885 tests across 93 files. Its tests emitted localhost connection, missing pull-request endpoint, and React `act` warnings. This result does not verify a production Durable integration.

## What remains unknown

Full bundled-extension compatibility, active subagent recovery, browser-dialog recovery, complete legacy-session conversion, permanent deletion, automatic compaction races, and operation at production catalog size remain unverified.

Durable marks its API experimental and says it changes without notice. Pinning versions and maintaining regression tests adds ongoing work. Its 1.1.0 context-retention option helps bound idle context caches, but this audit did not benchmark thousands of sessions.

The machine-pool parking-lot decision rejects Durable *as the reason to build pooling*. It does not reject Durable for restart recovery. A peer model and a durable local runtime can coexist.

## Decision status

The investigation supports proceeding to a bounded migration design. It does not establish readiness to switch production today. The cost is porting the runtime and extension/session contracts, with special attention to delegated-agent recovery and data preservation.

No architecture was selected, no production restart was authorized, and no migration was performed.
