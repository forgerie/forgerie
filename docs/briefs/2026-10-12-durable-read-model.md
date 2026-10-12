# Durable state as the parent read model

Use Durable as the authority for parent history and app state. Keep SDK JSONL
as a compatibility export, not as the source for browser reads.

| Part | Issue | Result |
| --- | --- | --- |
| Native fork | [#45](https://github.com/forgerie/forgerie/issues/45) | Native ancestry, stable entry IDs, and shared journal ownership. |
| App state | [#43](https://github.com/forgerie/forgerie/issues/43) | Parent forms, metadata, and extension state in documents. |
| Read model | [#46](https://github.com/forgerie/forgerie/issues/46) | Browser and server reads from committed Durable state. |

## Status and evidence

This is a design brief. It does not change runtime behavior.

- **Verified** means I read the implementation or ran the stated check.
- **Inferred** means the evidence supports the claim, but does not prove it.
- **Opinion** means a proposed decision. All instructions below are opinion
  unless a paragraph or table says otherwise.

**Verified:** This checkout pins `@earendil-works/pi-durable` to `1.1.0`.
Its whole README says the API is experimental. I also read the relevant
`dist` declarations and the observation, view, agent, provider, and usage
implementations. This worktree has no installed package dependencies. I read
the installed package in the main checkout. I did not edit that checkout.

**Verified:** I read `AGENTS.md`, both requested project skills,
[Pi Durable migration](../pi-durable-migration.md), and
[Durable child agents](../child-agents.md). The migration page describes an
older, partial stage. The current source is the authority for this brief.

**Verified:** The current parent adapter uses `watchEvents()`. However,
`messages`, stats, context estimates, names, tree reads, and fork choices still
use the SDK manager. `applyEvent()` calls `journal.project()` before each
batch event. The journal also projects before tools and provider requests.

**Verified:** `project()` does not export every raw entry. It skips internal
entries, imported model copies, reset and compaction entries, and identified
custom-input copies. It exports normal model messages and host display
entries. Thus the JSONL copy is neither a complete Durable journal nor an
exact description of native context.

**Verified:** The journal imports the active SDK projection into native
`forgerie.legacy-message` entries. It also stores the complete SDK entry list
in `forgerie.legacy-context`. `selectBranch()` writes a new head marker and
imports the selected context again. The runtime forks with
`SessionManager.createBranchedSession()`. It does not call native `fork()`.

**Inferred:** The host figures supplied for this task total about 57.4 GB:
5.4 GB SQLite, 3.0 GB `original.jsonl`, and 49 GB session JSONL. I did not
measure these directories. Some JSONL predates Durable. These figures do not
establish how much of the 49 GB can be removed.

Assume three adapter changes land before this work starts: prompt request IDs,
stats from `pi.usage`, and restart reconstruction of `activeSince`. Keep them.
Do not implement competing versions. Extend their tests for forks and snapshots.

## 1. Reads, live updates, and reconnect

### One committed source, several views

**Verified:** `ConversationView.entries` contains the active context range.
It is not the complete historical branch after compaction or reset.
`conversation.entries()` is a paged, fork-aware history read.
`conversation.context()` returns edited model contributions and ordered model
messages. These three contracts serve different readers.

| Consumer | Proposed source | Required behavior |
| --- | --- | --- |
| Live browser thread | `watch()` and a pure browser projection | Seed committed entries, partial answer, tool output, queue, and operation status. Keep stable message keys. |
| Older browser messages | Paged `conversation.entries()` | Include history before compaction. Reuse safe tool-round page boundaries. Do not expose raw documents. |
| Synchronous adapter getters | Cache from `viewState()` plus committed context reads | Treat the cache as derived state. Dispose it on detach. Never recover from JSONL when a native read fails. |
| `getSessionStats()` | Own `pi.usage`; history for message and tool-call counts | Keep the preceding stats change. Include committed compaction and failed-attempt usage. Do not sum inherited assistant usage as new fork spend. |
| `getContextUsage()` | `conversation.context().messages`, current agent model, and request preparation | Estimate the context actually sent, including the current system prompt and tool definitions where supported. Do not estimate from the full display transcript. |
| Tree | Native ancestry, complete entry scans, imported SDK graph, and label documents | Include inactive paths. Do not derive a tree from the current context alone. |
| Fork picker and `/fork` | Native history through the shared entry-ID map | Keep the current before-user and at-other-entry behavior. |
| Name and response status | App documents | Read committed state, not a JSONL tail or response checkpoint. |

Context usage remains an estimate. Extension `emitContext` hooks can change a
request. Record or compute the estimate at that existing request boundary.
Do not run those hooks again during a status read. Distinguish a prepared
request estimate from a next-request estimate. A missing estimate is unknown,
not zero. A partial answer is not yet a completed usage-ledger response.

**Verified:** `viewState()` and `watch()` mount only five built-in documents:
`pi.agent`, `pi.live`, `pi.inbox`, `pi.provider`, and `pi.usage`.
App documents do **not** appear automatically in `ConversationView.docs`.
Use `watchDoc()` or `documentState()` for each required app document. Ensure
those documents exist before attaching. Do not change the package's mount list.

Keep `watchEvents()` for SDK extension lifecycle hooks and the existing event
adapter. Derive the browser replacement snapshot from native state. Do not
emit the same browser message once from structural state and again from the
SDK event stream. Separate SDK notifications from browser reconciliation.
A replacement snapshot must not replay extension hooks or tool effects.

Preserve `browserMessageProjection.ts`. It removes private thinking signatures
and limits what reaches the browser. Apply it to snapshots, deltas, history,
and tree summaries. Do not send provider identity, extension payloads, or an
unfiltered `ConversationView` to the client.

### Attach and replace, not historical event replay

**Verified:** A native watch acquires its current value on the commit line.
It then delivers ordered frames to one async callback. More than 100 pending
frames become one whole-view replacement. `watchEvents()` has the same bound
in event batches and sends a fresh `snapshot`. The structural replacement uses
a Chord root-replace operation. It is not another append delta.

**Verified:** The current hub calls `socket.send()` without waiting for network
drain. Its sequence numbers live in daemon memory. The current browser opens
a socket, then reads messages, partial snapshot, and status separately.
A fast `send()` can hide an unbounded socket queue from Durable's watch limit.

Use this join contract:

1. Resolve the logical session and selected conversation without resuming work.
2. Attach native and app-state watches before publishing a seed. Buffer app
   changes through the same session publisher. Publish a seed from committed
   reads, then apply all later changes. Reconcile ask state by ask ID.
3. Send one browser snapshot with history page, partial, live tools, queue,
   status, and pending ask. Give the publisher a connection epoch and a local
   revision. These are transport values, not new durable state.
4. Send later frames in order. A root replacement replaces the seed state.
   It does not append duplicate messages or discard open disclosure identity.
5. On reconnect, discard the old epoch and attach again. Do not request replay
   from an old hub sequence. A late join receives the current committed view.
6. Stop watches on socket close, runtime replacement, and daemon close. Report
   listener failures. A failed watch must trigger resync or connection failure.

Do not claim that separate app-document and conversation watches share one
revision. Durable 1.1.0 does not provide an atomic combined mount for them.
Use a publisher seed barrier with buffered updates and explicit reconciliation.
Test a form change during attachment. Add a combined transactional snapshot
helper only if that test needs it.

The publisher must await a bounded transport send. Check `bufferedAmount` and
send completion. Close a stalled connection at a documented limit and let it
reattach. Keep no unbounded Forgerie queue between Durable and the socket.
A slow browser can still need a large whole-view frame. Bound history pages
and measure the largest active context before choosing the transport limit.

Preserve local drafts, shell output not yet saved, open cards, and scroll
identity during replacement. These are client state, not transcript authority.
Use existing components and styles. This brief makes no visual design choices.

## 2. JSONL compatibility and the complete reader inventory

**Verified:** I searched `src` for `SessionManager|\.jsonl` with recursive
`grep` because `rg` is absent. I also searched `getBranch`, `getEntries`,
`getTree`, context builders, and filesystem readers. Tests and test helpers
are excluded from this production inventory.

Paths in the first table are relative to `src/server/`.

| File | Current JSONL dependency | Removal plan |
| --- | --- | --- |
| `sessions/durableAgentSession.ts` | SDK context, name, stats, fork choices, metadata writes | Read model and app-state adapters replace these uses. |
| `sessions/durableSessionJournal.ts` | Import, backup, stamps, projection, branch reimport | Keep import and explicit export. Remove automatic full projection. |
| `sessions/durableSessionRuntime.ts` | SDK file fork and replacement | Native fork with a journal locator. |
| `sessions/piSessionManagerGateway.ts` | SDK create/open/list, read-only parsing, filename and header discovery | Dual-source catalog. Keep only the legacy reader and SDK export boundary. |
| `sessions/piSessionService.ts` | Messages, response, tree, search positions, usage for read-only worktrees, copy/spawn context, lineage, PR delivery deduplication, handoff, archive/restore/delete/promote/detach | Move all parent history reads behind one reader. Keep explicit legacy operations. |
| `sessions/sessionCatalogScanner.ts` | Header and tail windows, title and response metadata | Durable catalog records for native sessions; scanner for legacy only. |
| `sessions/sessionSummaryScanner.ts` | Full transcript summaries and incremental scans | Durable summaries for native sessions; legacy only afterward. |
| `sessions/sessionNameIndex.ts` | Incremental JSONL name scan and persistent name cache | Native names from documents; legacy cache remains. |
| `sessions/sessionSearchIndex.ts` | JSONL discovery, offsets, messages, tips, inactive paths | Native history batches keyed by durable identity; keep legacy indexing. |
| `sessions/sessionFileHeader.ts` | Bounded session header read | Native locator/catalog metadata; retain legacy header reader. |
| `sessions/sessionFileStats.ts` | File identity and offsets for scanner invalidation | Only legacy/export files need it. It does not parse transcript content. |
| `sessions/sessionArchiveStore.ts` | Copies, moves, restores, and deletes transcript files | Archive logical sessions and retain shared journal references. Legacy files keep current handling. |
| `sessions/agentSpawnedRepair.ts` | Discovers parent JSONL evidence | Restrict to legacy and external SDK sessions. |
| `sessions/agentSpawnedMarks.ts` | Reads tool-result paths; rewrites the child's header | Native catalog attribution; preserve external SDK repair. |
| `workspaces/sessionWorktreeStore.ts` | Header recovery and retained `.jsonl` transcript copies before removal | Durable locators or verified exports for retained read-only history. Never remove a journal with a referenced worktree transcript. |

The next table covers indirect consumers and wiring. These need no separate
native database reader.

| File | Current dependency | Target |
| --- | --- | --- |
| `sessions/sessionAsks.ts` | Injected fold of SDK response entries | Async app-document transitions; keep validation rules. |
| `sessions/sessionResponse.ts` | Folds SDK branches; inspects calling assistant and tool results | Keep a legacy fold and pure transition rules. Native response comes from a document. |
| `sessions/sessionResponseCheckpoint.ts` | Writes derived response checkpoints for JSONL catalog | Explicit export only; not native authority. |
| `sessions/askUserTool.ts` | SDK branch for terminal-tool validation and session identity | In-memory SDK compatibility view backed by native state. |
| `sessions/endTurnTool.ts` | SDK branch for terminal declaration and missing-reply recovery | Same compatibility view; declaration writes the response document. |
| `sessions/handoffSessionTool.ts` | SDK file and leaf references | Stable logical locator and mapped entry ID; legacy path stays supported. |
| `sessions/sessionCommandService.ts` | SDK leaf guards, fork picker, clone, parent header | Native history facade with unchanged command behavior. |
| `sessions/sessionTreeProjection.ts` | Pure projection of SDK-shaped nodes | Reuse sanitization on native-derived nodes. No storage reader belongs here. |
| `sessions/sessionSearchService.ts` | Catalog and active-branch positions; worker file refresh | Native catalog/positions and typed history batches. |
| `sessions/sessionSearchWorker.ts` | Starts the JSONL index and scans/refreshes files | Index supplied native batches as well as legacy files. |
| `sessions/sessionSearchProtocol.ts` | File-path worker requests | Add native batch/checkpoint messages; do not pass a live Harness to a worker. |
| `sessions/sessionSearchText.ts` | Extracts SDK entry text for the index | Reuse extraction on sanitized native-derived entries. |
| `sessions/durableSessionRecovery.ts` | Catalog file paths locate the DB; workflow inspection assumes the reserved root | Inspect each family once; recover selected and retained conversations with unfinished work. |
| `sessiond.ts` | Constructs the SDK gateway | Compose the dual-source reader and journal pool. |
| `sessiond/sessionServiceDependencies.ts` | Passes the gateway to the service | Pass the new reader and app-state factory at the same boundary. |

`githubTools.ts`, `projectTools.ts`, and `spawnSessionTool.ts` use the SDK
session ID, not transcript content. Preserve that logical ID. The event hub,
route layer, search worker, title bridge, cleanup, archive tree, and worktree
services consume the readers above. They must not add their own SQLite parser.
Pins, tabs, unread receipts, and worktree ownership use separate app files.
Those files are not session JSONL readers.

**Verified:** `durableSessionRecovery.ts` scans pending tasks and submissions
in the journal, but inspects an idle active workflow only at
`ROOT_CONVERSATION_ID`. Native forks make that assumption unsafe. Update
recovery to follow bindings and inspect all relevant conversation documents.
This is a high-risk dependency of #45, not an optional cleanup.

### Shrink the compatibility set in stages

| Stage | JSONL still required | Gate to leave the stage |
| --- | --- | --- |
| Read cutover | Extensions, catalog/search, archive/worktree snapshots, legacy sessions, rollback | Browser/status/tree work with projection disabled. |
| Reader cutover | Legacy sessions, SDK exports, external SDK tools | Discovery, search, archive, restore, cleanup, and retained worktree history pass mixed-store tests. |
| Extension cutover | Extensions that require concrete SDK APIs or a file; explicit interchange | Each supported extension passes against the derived in-memory SDK manager or a Durable-native API. |
| End state | User-requested SDK export and unmigrated legacy inputs | New hosted sessions need no growing JSONL file. JSONL is import/export, not a second live journal. |

The `ExtensionRunner` still expects SDK session behavior. Keep an actual
in-memory `SessionManager` as a derived compatibility view where needed.
Hydrate it from native entries and app documents before extension callbacks.
Intercept host-bound `appendEntry`, `setLabel`, and `setSessionName` writes.
Audit supported extensions for direct manager mutation and file access.
A file-dependent extension gets an explicit compatibility export, with a
visible cost. Do not silently restore continuous projection for all sessions.

Synchronous SDK callbacks cannot await a SQLite commit. Queue their typed
mutation intents on the adapter's existing mutation line. Flush them before
request preparation, tool completion, public success, and shutdown. Report
commit failure and fail that boundary. Do not publish a tentative name or form
as saved state. Document read-after-write behavior within one extension
callback. This compatibility limit needs tests; an in-memory manager alone
is not a durable write adapter.

## 3. Native fork, tree, IDs, and storage ownership

**Verified:** Native `fork(at, options, context)` takes a concrete visible
`EntryId`. It inherits entries through that ID, inclusively. It creates a
conversation in the **same** storage. Its agent starts as of the entry.
`ConversationRecord.parent` records the source conversation and cut entry.
There is no native SDK-style mutable leaf selector.

Use one journal per session family. The first session retains its current
`.durable/<session-filename>/state.sqlite`. A logical fork stores a locator
with that database and the new conversation ID. Do not copy a SQLite file and
resume copied tasks. Do not copy the whole parent transcript into a new DB.

A daemon pool owns one Harness and one existing kernel ownership lock per
canonical database path. Logical sessions hold leases. Closing one session
releases its watches and lease, not another session's tasks or the Harness.
Close the Harness after the last runtime/recovery lease ends. Dispatch parent
SDK tools and hooks by conversation ID. The current closures capture one
adapter; sharing them unchanged would route a fork's tools to its parent.

Keep logical Forgerie UUIDs separate from native conversation IDs and provider
UUIDs. Catalog records contain the durable locator. A session-scoped binding
document stores authoritative logical-to-conversation associations. The
catalog is a rebuildable discovery index, not a competing branch selector.
Persist the binding with native fork creation through `init`. Publish the
catalog after commit. Startup repairs a missed catalog publication.

Archive/delete must respect family references. Archiving a parent must not move
its DB away from a live fork. Deleting one logical session must not delete
inherited entries, child history, or other catalog references. Keep the shared
DB until a separate retention job can prove it has no retained references.
Native 1.1.0 has no complete product-level conversation garbage collector.

### Stable entry identity

Map browser/SDK string IDs to `(journalId, originConversationId, EntryId,
messageIndex)`. Native entry numbers are not globally unique. One entry can
contribute more than one SDK message. Use a message index for presentation,
but resolve a fork to the containing native entry.

Preserve imported SDK IDs. Keep reverse aliases for old bookmarks and search
hits. The existing projection stamps identify owner session and native entry,
not a complete cross-journal key. Do not trust a numeric stamp alone. Validate
that a target is visible in the requested conversation and belongs to its
logical tree. A stale or foreign ID fails, rather than forking the current tip.

Store the imported SDK graph and alias map once. Derive new native graph edges
from entries and conversation ancestry. A durable marker for a metadata change
can carry its SDK compatibility ID without repeating the metadata payload.
The pure tree projection consumes this graph. `expectedLeafId` remains a
stable presentation ID and is checked inside mutation admission.

| Operation | Native mapping | App behavior |
| --- | --- | --- |
| `/fork` at a user message | Resolve its visible predecessor; native fork at that entry | Return the selected user text as a draft. Do not submit it. |
| Fork from a non-user tree entry | Native fork at the resolved entry | Include that entry. |
| Clone current session | Native fork at the active tip | New logical UUID and related-session name. |
| Before the first user message | Fork at a model-empty origin anchor | Empty model context with valid historical agent choices. |
| Navigate to an earlier tree node | Select a retained continuation, or make a native continuation at that cut | Keep the logical UUID. Persist the selected conversation. Never append the selected prefix again. |
| Navigate with summary | Summarize the abandoned branch, then append a native summary/head entry to the continuation | Preserve cancellation and extension hook behavior. Do not use manual compaction of the current branch as a substitute. |

Create `forgerie.origin` before the first modeled contribution. It has no
model message. For old journals without a suitable anchor, import an empty
historical continuation once. Native `fork()` cannot fork at `null`.
A fork into the middle of an entry with several contributions is not available.
Keep imported contributions granular. Reject an unsupported mid-entry cut,
or explain the containing-entry boundary. Do not claim exact message-level
forks where the native API cannot provide them.

**Verified:** `pi.provider` is latest/initial. Each fork gets a fresh persisted
UUIDv7. Reopen, retry, reset, compaction, and model change retain it.
`pi.usage` is latest/initial, so inherited history is not charged again.
`pi.agent` is rewindable/asOf. Keep these built-in policies. Do not set the
provider ID to a logical Forgerie session ID or to its parent's provider ID.

Tree navigation to a new continuation therefore changes provider identity,
even if the logical session UUID stays the same. Returning to an existing
continuation restores that continuation's identity. This can reduce cache
reuse. It prevents two independent continuations from sharing provider state.

Keep child and workflow document definitions and task ownership unchanged.
A fork must not clone running children, ask receipts, worktrees, or workflow
launch tasks. Original conversations remain retained and reachable. Reject
navigation while relevant parent or child/workflow work is active. After a
branch switch, child history stays with its original owning conversation;
returning to that branch must recover it. Do not transplant tasks to the fork.

## 4. Parent documents

These are proposed version-1 document policies. `current` is for present-day
metadata. `asOf` is for execution state at a historical cut. `initial` prevents
copied live work. Session-scoped documents have no `history` or `fork` fields
in the actual API; `N/A` below is deliberate.

| State and proposed `kind` | Scope | `history` | `fork` | Reason and contents |
| --- | --- | --- | --- | --- |
| Ask forms: `forgerie.parent-asks` | conversation | latest | initial | Current pending form plus accepted-answer delivery receipts. A fork must not reopen a parent's form or deliver its answer twice. |
| Response declaration: `forgerie.parent-response` | conversation | rewindable | asOf | `end_turn`, undeclared-run state, and reply intent belong to the historical branch. Store response intent separately from the live pending form. |
| Labels: `forgerie.labels` | conversation | latest | current | Labels are present-day annotations. Copy only targets visible in the fork; later parent label changes do not change the fork. |
| Session name: `forgerie.session-name` | conversation | latest | current | Use the present title, then apply the existing Fork/Copy naming rule in fork initialization. Reopen reads this document. |
| Extension custom entries: `forgerie.extension-entries` | conversation family, keyed by custom type | rewindable | asOf | Preserve append order, SDK entry IDs, and arbitrary strict-JSON payloads. An extension can reconstruct its state at the cut. Do not reduce an unknown extension to its last payload. |
| Custom and shell display envelopes: `forgerie.presentation` | conversation family, keyed by native entry ID | rewindable | asOf | Preserve `customType`, display flag, details, shell command, and result fields not present in the model copy. The entry supplies model content; the document supplies its SDK/browser form. Avoid two copies of large output. |
| Handoff lifecycle: `forgerie.handoff` | conversation | latest | initial | Source/destination IDs, document path, phase, and delivery receipt describe a live operation. A fork must not resume the old transfer. Keep historical notices as entries. |
| PR notice delivery: `forgerie.notice-receipts` | conversation | latest | initial | Deduplicate future notice delivery for this conversation. Historical notice cards remain inherited entries, not new deliveries. |
| Missing-reply retry state: `forgerie.parent-response` | conversation | rewindable | asOf | Preserve the existing one-retry boundary across restart and historical cuts. Do not reset a spent retry by navigating. |
| Imported graph and SDK aliases: `forgerie.legacy-tree` | session | N/A | N/A | Immutable import data shared by the family. Native graph additions remain entries and ancestry, not copies in this document. |
| Logical bindings: `forgerie.session-bindings` | session | N/A | N/A | Logical UUID, selected conversation, retained continuations, lineage, and stable journal identity. Fork initialization adds a new binding, not a copy. |
| Import/export progress: `forgerie.migration` | session | N/A | N/A | Source hashes, import version, completion receipt, and verified export boundary. Replace or version the existing `forgerie.import` receipt without losing it. |
| Legacy spend baseline: `forgerie.imported-usage` | conversation | rewindable | asOf | Preserve historical estimates that native import did not record in `pi.usage`. Show separately from own native spend. Never add already-stamped native responses twice. |

The response read model combines declaration intent with the **current** asks
document. If a historical declaration says questions but the fork has no live
form, expose reply intent or no pending form, not an actionable phantom form.
Keep historical asks and answers visible as history. They are not live forms.

Ask transitions must validate and commit before publication. Store the close
outcome and a deterministic answer-delivery ID in the same transaction. A
Durable task admits its follow-up with that request ID and records the receipt.
Restart retries delivery, not a new user decision. Keep supersede, stale submit,
cancel, and answered-in-chat semantics. Do not erase accepted answers when
follow-up admission fails. The current termination behavior does not require
inventing a suspended human-wait task for the parent.

Custom entries need both append semantics and historical boundaries. Append a
small native marker in the same commit as each document change. This gives
`asOf` a concrete entry cut and gives the SDK tree a node. Do not copy the full
custom payload into both the marker and the document. Large extension logs can
still make documents expensive. Measure them before introducing checkpoints
or domain-specific reducers.

Model, thinking, tools, instructions, and cwd already belong in `pi.agent`.
Queue state belongs in `pi.inbox`. Live activity belongs in `pi.live` and task
receipts. Keep the preceding `activeSince` reconstruction from those records.
Do not create another activity timestamp document.

Keep pins, tabs, read receipts, profile settings, credentials, and Git worktree
ownership in their current app stores. Their scope crosses conversations or
has an independent external lifecycle. Keep browser extension dialogs ephemeral
unless an extension explicitly owns a durable request. Do not revive arbitrary
process-local dialog promises after restart. Managed processes need their own
recovery design; moving their transcript cards does not keep a process alive.
Child agents and workflows remain on their existing documents and tasks.

## 5. Migration, including never-opened sessions

Keep mixed-store reads. A native locator selects Durable. No locator selects
the read-only legacy reader. A failed or incomplete native journal is an error,
not a reason to execute or overwrite its JSONL as a new import.

1. Inventory configured session roots, active and archived records, retained
   worktree transcripts, existing native journals, and external SDK sessions.
   Record file identity, byte counts, hashes, parse status, and logical IDs.
   Do not run archive ownership repair as part of this migration.
2. Add import versioning and native locators. Preserve every logical UUID,
   parent path alias, SDK entry ID, label, name, custom payload, and branch.
3. For never-opened sessions, run a bounded offline importer or import on first
   explicit open. Do not start tasks, replay tools, regenerate titles, or call a
   provider. Discovery and search alone must not migrate or resume a session.
4. Import the **whole SDK tree**, not just `buildSessionProjection()`. Build
   native continuations from common prefixes. Apply model/thinking changes and
   rewindable app changes at their original marker boundaries. Preserve
   compaction, branch summaries, custom envelopes, and excluded shell context.
5. For already-opened Durable sessions, use `forgerie.legacy-context`, current
   JSONL, and original backup to recover the missing graph and app metadata.
   Use SDK IDs and owner/native stamps, never text matching. Repeated text can
   be real input. Old `selectBranch()` imports can repeat the same SDK source
   contribution. Map those occurrences; do not turn them into duplicate cards.
6. Keep existing native conversation IDs, tasks, child documents, and workflow
   documents intact. Add missing historical continuations and mappings in place.
   Reuse an existing native target only if its context matches the required
   SDK cut. Otherwise import that historical continuation once. Do not rewrite
   immutable native entries or replace the whole DB to repair the SDK graph.
7. Quiesce affected parent and child/workflow work for app-state backfill.
   Import recent JSONL-only metadata before disabling those writes. If sources
   disagree, record the conflict and stop that session's cutover. Do not pick
   whichever file has the latest filesystem timestamp.
8. Commit a per-session completion receipt only after counts, context, graph,
   aliases, metadata, and source hashes pass comparison. Publish the catalog
   after that commit. Retry can find completed work after a crash.
9. Enable native reads for a small cohort. Keep compatibility export available.
   Cut discovery/search/archive over only after mixed-store acceptance passes.
10. Remove automatic projection for accepted sessions. Batch remaining imports
    with limits on memory, concurrency, and added disk. Leave rejected files
    unchanged and visible as legacy or an explicit migration error.

A monolithic legacy-tree document may be large. It is a one-time preservation
boundary, not a new live append log. Use paged source parsing and import
receipts. If 1.1.0 cannot preserve a session's exact graph/context combination,
keep that session on legacy reads and report the unsupported cut. Do not
silently flatten it. An offline import can increase SQLite before JSONL is
removed, so require free-space checks and a restartable batch manifest.

## 6. Disk and backup retention

| Change | Expected impact | Limit |
| --- | --- | --- |
| Stop continuous JSONL projection | Stops growth of a second transcript for accepted native sessions | Existing files still occupy disk. |
| Native fork | Shares inherited entries in one journal | New continuations and document history still grow. |
| Remove branch reimport | Avoids writing the selected context on each navigation | Existing repeated imports remain immutable history. |
| Migrate unopened JSONL | Adds native data before retiring legacy data | Requires temporary free space; 49 GB is not a savings estimate. |
| Retire `original.jsonl` | At most about the reported 3.0 GB before compression/retention costs | Only after complete historical import and rollback proof. |
| Native compaction | Reduces provider context and token cost | Does not delete old entries or shrink the SQLite file. |

Measure per-session DB, WAL, JSONL, backup, export, and search-index sizes.
Compare bytes added per turn and per fork. Record p50/p95 read times and peak
RSS for long sessions. Measure a large real session with a read-only path.
Do not use total host size as evidence of projection overhead.

Keep `original.jsonl` immutable during migration. Write a manifest with source
hash, size, native locator, import version, and last verified export. Deduplicate
by content hash only after verification; names are not evidence of equality.

Retain local originals until all branch and custom-state checks pass and a
rollback drill succeeds. Proposed minimum: 30 days after that session's
accepted cutover. Copy them to a checksummed, compressed, encrypted archive
outside the live session directories. Test restoring both JSONL and the paired
SQLite snapshot. Then request approval for deletion of the listed local files.
No automatic backup deletion belongs in these three parts. Expiry does not
prove a backup is safe to delete.

Snapshot SQLite through its backup API, or close and checkpoint it before a
consistent copy. Do not copy only `state.sqlite` while WAL writes continue.
A future offline vacuum needs the existing ownership lock, checked free space,
and recovery verification. It cannot reclaim live retained history by itself.

## 7. Rollback

Keep a feature gate per migration version. The rollback target is a compatible
Durable build with JSONL reads enabled, not a return to SDK agent execution.
The accepted execution model remains Durable.

| Boundary | Rollback action | Risk |
| --- | --- | --- |
| Before native read cutover | Disable new reads; use intact compatibility files | New app writes must have been exported at the verified boundary. |
| After native forks or documents exist | Use a fallback build that understands locators and documents; generate verified SDK exports | An older build that assumes one root per file cannot safely open native forks. |
| After continuous projection stops | Pause writes; export every retained logical tree and app state to fresh files; verify; switch the read gate | `original.jsonl` lacks all post-import work. Restoring it alone loses data. |
| Native journal damage | Stop ownership; restore a paired consistent snapshot and manifest | State after the snapshot may be lost. Never rerun unsafe tools to reconstruct it. |

The exporter must include inactive paths, aliases, labels, names, custom entries,
forms and answer receipts, shell envelopes, compaction markers, and current
selection. Keep native-only usage and task receipts in the retained DB and
export manifest. An old SDK stats reader cannot reproduce compaction spending
from assistant messages alone. Report that limitation.

Write exports to new paths, read them with the legacy read-only loader, compare
history and context, then publish atomically. Keep the original journals and
locators. Never merge two independently written files by message text.
Do not resume work in both the fallback build and the new build. Take the
ownership lock and drain or explicitly stop work before rollback. A rollback
cannot undo external tool effects or uncommitted provider spending.

## 8. Three parts with separate ownership

### Required shared seams before parallel implementation

Make a small contract commit first, after the three preceding adapter fixes.
The owners below define these contracts together. Only read-model edits
`durableAgentSession.ts` and `piSessionService.ts`. Other parts implement their
modules and use those delegates. Do not have three workers edit the facade.

| Seam | Defining part | Invariant |
| --- | --- | --- |
| `durableSessionAddress.ts` | native-fork #45 | Stable journal/logical identity and selected native conversation; schema validates filesystem locators. |
| `durableParentContracts.ts` | read-model #46 | Public read and mutation capabilities; no SDK or UI import. |
| `durableParentDocuments.ts` | app-state #43 | Versioned document tokens and payload schemas from section 4. |
| `durableNativeHistory.ts` | native-fork #45 | Entry aliases, graph, fork cuts, and visibility checks. |
| `durableParentState.ts` | app-state #43 | Async validated transitions and committed app snapshot. |
| `DurableAgentSession` delegates | read-model #46 | Preserve `PiAgentSession` while moving behavior into owned modules. |
| Browser snapshot schema | read-model #46 | Filtered replacement and delta contract; one schema source, no raw package types on the wire. |

Exact proposed server signatures follow. Use exported package types. Payload
schemas produce the app types; do not hand-write duplicate wire validators.
`DurableSessionHandle` owns a lease, not the whole family's Harness.

```ts
import type { Context } from "@earendil-works/chord/context";
import type {
  Conversation, ConversationId, EntryId, Harness, JsonValue,
} from "@earendil-works/pi-durable";
import type {
  AskUserOutcome, AskUserQuestion, AskUserSubmission, PendingAskUser,
  SessionTreeSnapshot,
} from "../../shared/apiTypes.js";
import type { SessionResponse } from "../../shared/sessionResponse.js";
import type {
  PendingAskCloseResult, PendingAskOpenResult,
} from "./sessionAsks.js";

export type DurableSessionAddress = {
  journalId: string;
  databasePath: string;
  sessionId: string;
  conversationId: ConversationId;
};

export type DurableEntryTarget = {
  journalId: string;
  conversationId: ConversationId;
  entryId: EntryId;
  messageIndex: number;
};

export interface DurableSessionHandle {
  readonly address: DurableSessionAddress;
  readonly harness: Harness;
  readonly conversation: Conversation;
  release(context: Context): Promise<void>;
}

export interface DurableNativeHistory {
  tree(context: Context): Promise<SessionTreeSnapshot>;
  resolve(entryId: string, context: Context): Promise<DurableEntryTarget>;
  fork(
    entryId: string,
    position: "before" | "at",
    newSessionId: string,
    context: Context,
  ): Promise<{ handle: DurableSessionHandle; selectedText?: string }>;
  select(
    entryId: string,
    options: { summarize?: boolean; customInstructions?: string },
    context: Context,
  ): Promise<{
    handle: DurableSessionHandle;
    cancelled: boolean;
    editorText?: string;
  }>;
}

export interface DurableParentState {
  response(context: Context): Promise<SessionResponse>;
  pendingAsk(context: Context): Promise<PendingAskUser | undefined>;
  declareResponse(
    awaiting: "nothing" | "reply", context: Context,
  ): Promise<void>;
  voidForChatReply(context: Context): Promise<AskUserOutcome | undefined>;
  openAsk(
    questions: readonly AskUserQuestion[], context: Context,
  ): Promise<PendingAskOpenResult>;
  submitAsk(
    askId: string, submission: AskUserSubmission, context: Context,
  ): Promise<PendingAskCloseResult>;
  cancelAsk(
    askId: string, context: Context,
  ): Promise<PendingAskCloseResult>;
  appendCustomEntry(
    customType: string, data: JsonValue | undefined, context: Context,
  ): Promise<string>;
  setLabel(
    entryId: string, label: string | undefined, context: Context,
  ): Promise<void>;
  setSessionName(name: string, context: Context): Promise<void>;
  flush(context: Context): Promise<void>;
}
```

`resolve()` rejects unknown, foreign, ambiguous, and invisible targets. `fork()`
returns an acquired candidate lease. Runtime replacement releases it on
failure. `select()` updates the logical binding only after successful summary
and candidate validation. Cancellation leaves the old binding unchanged.
`release()` is idempotent. No read method resumes the scheduler.

The seam commit adds these exact facade methods. `history` and `parentState`
are constructed from the facade's current handle and rebound after selection.

```ts
// On DurableAgentSession. Implementation belongs to read-model #46.
get durableAddress(): DurableSessionAddress;
get nativeHistory(): DurableNativeHistory;
get parentState(): DurableParentState;
flushDurableMutations(): Promise<void>;
getDurableTree(): Promise<SessionTreeSnapshot>;
```

Add an optional `handle: DurableSessionHandle` to
`DurableAgentSessionOptions` and `DurableRuntimeOptions`. Absence means acquire
or import the old root. Presence means bind the candidate conversation; never
call `harness.root()` instead. Native-fork owns acquisition and leases.
Read-model owns facade binding, derived caches, and extension dispatch.

App-state defines a factory with this signature:

```ts
createDurableParentState(
  handle: DurableSessionHandle,
  history: Pick<DurableNativeHistory, "resolve">,
): DurableParentState;
```

Native-fork calls app-state initialization through an injected callback, not
through imports of the service or facade. Its exact signature is:

```ts
import type { ConversationRecord, Tx } from "@earendil-works/pi-durable";

type InitializeParentDocuments = (
  tx: Tx,
  conversation: ConversationRecord,
) => Promise<void>;
```

App-state implements that callback. Native-fork invokes it from creation/fork
`init` and import commits. Read-model supplies it at composition. Keep existing
child/workflow initializers intact. A follow-up app-state commit adds response
and presentation snapshot types to this contract file through read-model's
owner, rather than editing shared files concurrently.

### Native-fork — #45

**Owns:** `durableSessionAddress.ts`, `durableNativeHistory.ts`,
`durableSessionBindings.ts`, `durableJournalPool.ts`,
`durableSessionJournal.ts`, `durableSessionRuntime.ts`,
`durableSessionRecovery.ts`, `durableLegacyImport.ts`,
`sessionCommandService.ts`, and their tests.
New files are proposed. Existing files use the `src/server/sessions/` prefix.
The import module owns graph import and receipts; it calls app-state backfill
through the shared transaction callback. Read-model owns any service wiring.

**Tests:** Real temporary SQLite with two logical sessions and one owner lock;
reopen both; before-first-user, at-entry, clone, inherited target, invalid ID,
several messages in one entry, failed candidate, cancelled summary, stale leaf,
provider identity, historical agent, and zero inherited own spend. Import a
branched legacy fixture without a provider call. Test missed catalog publish
and lease close while a sibling runs. Keep existing child/workflow tasks and
receipts unchanged through restart and fork.

**Acceptance:** `/fork`, clone, tree navigation, and reopen use native ancestry.
No branch operation appends the selected prefix again. Parent and fork can be
open together without a second Harness. A retained sibling survives archive or
removal of a logical parent. Provider IDs follow section 3. The original parent
stays usable when replacement fails.

**Cost and risks:** Largest lifecycle change. Shared storage requires
conversation-specific SDK routing and correct leases. Imported historical cuts
may need one-time reconstruction. Retained deleted conversations delay disk
reclamation. It does not implement physical garbage collection, cross-host
ownership, independent fork DB export, or undo external tool effects.

### App-state — #43

**Owns:** `durableParentDocuments.ts`, `durableParentState.ts`,
`durableParentStateImport.ts`, `durableAskDelivery.ts`, `sessionAsks.ts`,
`sessionResponse.ts`, `sessionResponseCheckpoint.ts`, `askUserTool.ts`,
`endTurnTool.ts`, and their tests. It does not edit `durableAgentSession.ts`
or `piSessionService.ts`. Read-model wires async calls to these modules.

**Tests:** Real SQLite for declare/open/submit/cancel/supersede, malformed and
stale answers, concurrent browser submits, answered-in-chat, crash after close
but before delivery, same request-ID replay, labels, names, custom append order,
JSON validation, `asOf` boundaries, and each fork policy. Verify no phantom form
and no copied delivery task. Run configured SDK extensions through the real
runner. Test failed queued commit at the enclosing callback boundary.

**Acceptance:** Forms, declaration state, metadata, and custom entries survive
restart with JSONL projection disabled. Accepting an answer cannot lose it or
send it twice. Forks inherit only the state selected in section 4. Existing
child and workflow schemas and launch behavior are unchanged.

**Cost and risks:** The synchronous SDK write contract needs a reliable flush
barrier. Generic custom-entry history can be large. Wrong `asOf` boundaries can
leak future extension state. It does not make SDK file-dependent extensions
native, restore arbitrary browser dialog promises, migrate app-wide stores,
or recover operating-system processes.

### Read-model — #46

**Owns:** `durableParentContracts.ts`, `durableAgentSession.ts`,
`durableParentReadModel.ts`, `durableSdkSessionView.ts`,
`durableSessionReader.ts`, `durableSessionExport.ts`, `piSessionService.ts`,
`piSessionManagerGateway.ts`, `sessionRoutes.ts`, `sessionTreeProjection.ts`,
`sessionCatalogScanner.ts`, `sessionSummaryScanner.ts`, `sessionNameIndex.ts`,
`sessionSearchIndex.ts`, `sessionSearchService.ts`, `sessionSearchWorker.ts`,
`sessionSearchProtocol.ts`, `sessionSearchText.ts`, `sessionArchiveStore.ts`,
`src/server/realtime/sessionEventHub.ts`, `src/server/browserMessageProjection.ts`,
`src/server/sessiond.ts`, `src/server/sessiond/sessionServiceDependencies.ts`,
`src/server/workspaces/sessionWorktreeStore.ts`, and their tests.
It owns new snapshot schemas in `src/shared/`, plus `ui/src/contracts.ts`,
`ui/src/sessionStore.ts`, and their store/reconnect tests. No component styling
or layout change is included. Read `ui/docs/decomposition.md` before UI edits.

**Tests:** Real temporary SQLite, real routes and WebSocket clients. Disable
JSONL projection and verify messages, stats, context after native compaction,
tree, late join during tool output, queued inputs, and reconnect after daemon
restart. Block a consumer for more than 100 commits and verify replacement,
not duplicate append. Test socket backpressure, watch failure, ask change during
seed, private-field filtering, several entry contributions, and stable UI
identity. Compare legacy/native mixed catalogs, search including inactive
paths, archive/restore/delete with shared DBs, and removed-worktree history.
Test offline export and a fallback-read rollback drill.

**Acceptance:** The browser and server read native state even if the export is
missing or stale. Reads never start tasks. One attachment recovers a full
current state; reconnect does not replay effects. Native discovery works before
the first assistant. Search and archive no longer require a growing native
JSONL copy. Use the four Galaxy Z Fold 8 postures in both color schemes; inspect
all captures. Preserve drafts and open cards across reconnect and rotation.

**Cost and risks:** Widest reader inventory and transport work. Whole-view
replacement can be large. SDK cache hydration and legacy alias handling need
measurement. Mixed stores extend support work. It does not provide exact
provider billing, record uncommitted spend, finish the earlier SDK-hook parity
migration, replace app-wide indexes, or reclaim all old JSONL immediately.

### Integration order

1. Land the three preceding adapter fixes, then the shared contract commit.
2. Build the three owned modules in parallel. Keep continuous export while
   native-fork and app-state acceptance runs.
3. Read-model integrates delegates and async service calls. Do not duplicate
   state in the service. Rebase the other parts only on stable seam commits.
4. Enable native browser/status/tree reads. Then enable dual-source discovery,
   search, archive, worktree history, and rollback export.
5. Disable continuous export for accepted sessions. Backup deletion and native
   physical retention remain separate approved work.

Before implementation commits, run `npm run verify` on Node 24. Exercise a
session through real HTTP and WebSocket paths, fork it, reopen it, answer a
form after restart, and export it. These are implementation acceptance gates,
not claims that this documentation change passed those tests.

## 9. Checks performed for this brief

**Verified:** A Node `v24.13.0` inline check exercised the installed 1.1.0
package with real `Harness` and `MemoryStorage`. It passed five assertions:
rewindable/asOf state at a fork; fresh fork provider identity; custom documents
absent from the structural mount; whole-view replacement after 103 commits
behind a blocked listener; and a late join with 104 visible entries. The slow
watch delivered three frames, including a root replacement. No provider ran.
The first attempt used the wrong Chord import path and failed before opening
a Harness. The corrected `dist/context/index.js` path passed.

**Verified:** This is a package-contract check, not a Forgerie integration test.
No production session was opened or changed. No code, deployment, merge, land,
or push is part of this task. Documentation validation uses `git diff --check`
and referenced-path checks. `npm run verify` was attempted on Node 24 with a
30-second limit. Typecheck completed. The command reached lint, then timed out.
It resolved tools from the ancestor checkout's dependencies. No full verify
or project test pass is claimed for this one-file design change.

The commit hook also passed cached typecheck. Knip then failed with two unused
devDependencies and six unlisted binaries in this dependency-less worktree.
Those findings concern unchanged package metadata, not this Markdown file.
The documentation commit uses a one-command hook bypass. No permanent Git
configuration changes. Implementation commits must pass the full checks.
