# Fast chat open

Status: implementation contract, 2026-10-14. Base: cdb22b2c.

## Finish line and evidence

Normal selection paints the last turn. A selected chat retained in the six-entry cache paints on the next animation frame without starting a network request. An uncached selection needs one transcript HTTP read. Older turns prepend without moving the reader's visible anchor. Do not add IndexedDB or transcript localStorage.

Measured baseline and raw data: `/home/simonwjackson/.cache/research/chat-fast-open-20261014T172957/baseline.md`. Run `node ui/scripts/fast-chat-open-baseline.mjs /tmp/baseline.json` against the isolated managed fixture server. Build first with `npm --prefix ui run build`; server command is `node_modules/.bin/tsx scripts/fast-chat-open-server.mjs 18641`. Add `--first-page` on port 18642 for the page probe. Stop both through the process tool afterwards. These are temporary fixture processes, not shared workspace services.

| Fixture | Turns / raw messages | Mean readable last turn ms | Network sum ms | JSON parse ms | Main-thread work upper bound ms | Retained page heap MiB | Dominant part |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| small | 20 / 180 | 357.1 | 30.8 | 0.53 | 350.6 | 24.3 | Main thread |
| large | 300 / 2700 | 3539.3 | 38.8 | 6.63 | 3536.9 | 112.8 | Main thread |
| huge | 1500 / 13500 | 18620.6 | 131.2 | 32.03 | 18959.0 | 482.2 | Main thread |
| streaming | 20 / 180 + partial | 1365.2 | 41.7 | 0.40 | 1715.7 | 29.1 | Main thread |
| small revisited after 10 s | 20 / 180 | 353.9 | 26.9 | 0.70 | 346.6 | 30.2 | Main thread |

Verified on the built production UI, classic transport, production session routes/projection/paging, deterministic in-memory service data, Chromium 155, Node 24.13.0, 1440×900 DPR1, localhost, no throttling. Not verified: real storage/runtime acquisition, native Durable latency, physical-device paint, six retained screens. Response JSON decoding is instrumented. The render number includes normalization/schema/React/layout/paint and observation overhead, not isolated React commit time. Network and CPU overlap. GC runs between opens and after heap samples; natural-GC latency is not an acceptance result. First-paint checks use rAF and DOM geometry, not pixel comparison. A readable marker's containing block intersects the viewport; exact glyph visibility still needs browser acceptance.

Three full-history runs: max/min readable spread small 5.6%, large 2.3%, huge 3.7%, streaming 15.9%, revisit 18.9%. The requested strict 15% repeatability gate **failed** for streaming and revisit. Keep that finding; do not turn it into a weaker average-deviation gate. The parent accepted continuing with these limits. Before any faster claim, rerun the same protocol against baseline and changed code with three comparable runs. This baseline does not quantify the open endpoint's storage/network benefit. Paging and kept screens are the primary measured levers.

### Targets, not claims

| Fixture | Uncached click → readable last turn target | Kept return target | Transcript HTTP reads |
| --- | ---: | ---: | ---: |
| small | ≤250 ms | next frame (16.7 ms at 60 Hz) | 1 / 0 kept |
| large | ≤300 ms | next frame | 1 / 0 kept |
| huge | ≤500 ms ceiling | next frame | 1 / 0 kept |
| streaming | ≤300 ms | next frame, current partial retained | 1 / 0 kept |

Metadata already owned by the picker is not a second transcript read. WebSocket upgrade is a separate live channel, not the HTTP open read. Commands, panel details, and acknowledgement writes must not block transcript paint. Kept selection itself must trigger **no** request, including ancillary effect reads. A disconnected kept store still paints cached content first; recovery caused by the disconnect may read in the background. Do not call a recovery read a zero-request healthy return.

## 1. Open boundary

`GET /api/sessions/:id/open?cwd=<absolute cwd>&limit=50[&around=<raw position>]` (and the existing machine-proxy equivalent). Session routing/authentication stays unchanged. Validate finite safe integers; limit 1–500, default 50; around nonnegative. Reject malformed query with 400, absent session with 404, a changed history identity with 409, unavailable/failed consistent read with 503. Use the normal `{error, code?}` error envelope. No mutation or scheduler resume from native opens.

One response contract:

- `session: {id,cwd,name?}`: full resolved ID, not a prefix.
- `readPath: "classic" | "native"`.
- `epoch: string`: daemon transport epoch; stable across sockets, new after daemon restart.
- `seq: number`: nonnegative safe integer transport watermark.
- `historyId: string`: opaque identity of the append-only presentation history. Stable under append; changes on branch movement, compaction/reset that changes indices, or projection replacement. Do not use the current leaf as this identity: appends move the leaf.
- `page: {messages,start,total}`: projected presentation messages in ascending order, positions in that same presentation sequence; `0 <= start <= total`, `start + messages.length <= total`. Default page ends at total. Around pages include the target's whole turn; they need not end at total.
- `snapshot: {seq,partial,tools,transientEvents}`: same seq as the envelope; partial is projected assistant message or null; tools contain native pending/running tool state; transientEvents contain only synthesized shell start/chunk/end and command output required to seed unsaved host output. Do not put raw SDK events, private fields or process launch records here.
- `status`: the current status including asks, dialogs, queues, shell/compaction state, readOnly and worktree metadata.
- `receipt: null | {catalogId,throughCompletionOrder}`: guarded unread boundary captured **before** the transcript read. Null means no acknowledgement boundary, not that the client may mark newer work read.

Shared generic envelope lives in `src/shared/sessionOpen.ts`. The UI's concrete Zod instantiation is `sessionOpenSchema` in `ui/src/contracts.ts`. Server types bind the envelope to projected browser messages and server SessionStatus in `src/server/sessions/sessionOpen.ts`. The schema owns integer/shape/invariant checks; do not build a second ad-hoc parser. Existing `/messages`, `/status`, `/stream-snapshot` stay compatible for other consumers.

### Consistency: do not parallel-fetch three old endpoints and call it atomic

| Path | Required acquisition | Failure and test |
| --- | --- | --- |
| classic active | Resolve/open runtime and await file/worktree/unread preparation first. Then clone branch history, partial, status and transient host output with `currentSeq` in one synchronous tick, without an await inside the cut. Use the active SessionManager's branch, not a separately reopened file. Take projection/page cuts from the detached copy. Control/ask events after the cut are buffered/replayed above seq. | Completion, ask-close or shell-chunk at each preparation await cannot yield mixed history/status. Tests hold each await and publish real events; assert single cut and no duplicated delta. |
| classic inactive/read-only | Acquire immutable saved branch; no live partial. Verify file identity and historyId before publication; retry boundedly on replacement, otherwise 503. Retain read-only metadata. | File replaced/branch changed mid-read must not combine old messages with new positions. Test real temp JSONL replacement. |
| Durable native | Acquire read lease without resume/root/import. Flush only already-admitted SDK metadata intents if an active facade exists. Read entries plus LiveDoc, InboxDoc, AgentDoc, ParentAsks, ParentResponse, SessionName, presentation documents and usage on the Harness's serialized **read-only conversation.commit callback**. `Tx.scanEntries` and `Tx.doc` are public seams. Read all required table rows before any write; initialized documents must exist. Never create missing documents as a repair during open. Use the committed fork-aware history, not only the compacted ConversationView.entries. Clone values before returning; page the copied presentation sequence. | Separate conversation.watch + appWatch acquisitions are NOT one commit boundary. Test commit between generation and ask changes, pre/post compaction entries, missing docs, no scheduler resume and read-lease release on failure. A missing locator alone permits legacy fallback; native errors never do. |

The native transport watermark must include adopted native commits, not just SDK callback events. Extend the event hub's checkpoint metadata from `Harness.subscribeCommits`; stamp relevant committed changes once, on adoption. Native seq is a **transport checkpoint**, not a Durable EntryId or the existing per-watch revision. Sample the hub epoch/seq before and after the serialized native read; if ephemeral host events change it during the read, repeat boundedly. Because native commits are serialized on that line, the detached native data is a single committed cut. Max three acquisition attempts, then explicit 503; no misleading successful mixed snapshot. Do not use a new per-attachment UUID as a checkpoint epoch. Keep existing native watch epoch/revision meanings separate.

The optimized event subscription (`events?...&open=1`) must establish the same epoch and watermark and retain the current source's authority. For native replacements, send an open-envelope checkpoint derived from the same committed acquisition, not the old independently merged app/conversation frame. For classic, keep deltas. Attach before the HTTP read and buffer until seeded. Keep only events above its seq; reject a late open older than an already-applied checkpoint. Ignored/private events may consume seq: clients must NOT assume `seq + 1` for every consumed UI event. Uncertainty, overflow, or epoch mismatch means an authoritative replacement, never appending a new full history.

**Host output:** the hub owns a reconstructible projection of unsaved shell start/output/end, fed by existing shell producers. It must be seeded in open, including an already running shell on a cold open. Saved shell history replaces its matching transient row exactly once. Command outputs retain their current non-transcript presentation. Bound transient output using the existing shell truncation policy; do not add a new silent drop policy. Keep browser-projection filtering and full-output disclosure guarantees. This is transient state, not a second durable transcript.

Tests: route validation/proxy, projected privacy, one-request cold open, mid-open native/classic run completion, ask open/close, dialogs, queues, shell with output before subscribe, persisted shell deduplication, readonly history, daemon epoch restart, late HTTP response, and cancellation. Failures keep cached content and show existing connection/problem controls; never retry a mutation.

## 2. Paging and targets

Default `first_page_limit=50` counts raw projected messages, not rendered replies or turns. Expand the start backward to a user boundary. The fixture's 50 request therefore returns **54** messages (6 complete turns). An indivisible turn may exceed 50: never cut through a tool round. Keep the existing native 500-message safe-turn ceiling and explicit error for an oversized turn; do not silently truncate its results.

Older read: `GET .../messages?cwd=...&before=<page.start>&limit=50&historyId=...`. Before is an exclusive position in the same presentation history. Accept only a boundary produced by the server; reject other cuts rather than leaving dangling results. Return `messages,start,total,historyId,epoch,seq` for new paged callers; keep old callers compatible. The older page ends at old start, starts at a user boundary, and contains no current-page overlap. Append-only live growth may increase total; older indices remain unchanged. A historyId mismatch gives 409 and store replacement, not merging branches. One in-flight older read per store; repeated calls share its promise. Failed/cancelled loads leave messages/start/anchor unchanged and permit retry.

Store raw positions are absolute: offset normalized message.position by page.start, including the native source-ID lookup. Keep completed message object identity on prepend and on live updates. Stable IDs survive branch refresh and tool-result joining; never derive identity from the array's current local index. Merge only after validating the historyId and current request generation.

| Target | Contract | Failure/test |
| --- | --- | --- |
| On-branch search hit | `ensurePosition(position): Promise<void>` loads an around page or the missing contiguous range before producing Thread.reveal. Existing search positions refer to the projected whole branch. If replacing the tail window with an around window, preserve a bookmark for return to tail and load missing ranges explicitly; never concatenate disjoint ranges as contiguous history. | Search outside first page, joined assistant ID, repeated next/previous matches, stale search position after branch move. Use stable entry resolution/requery on 409. |
| Off-branch search hit/history tree | Keep current history-tree behavior; resolve entry ID in full tree, never navigate a branch merely to show a hit. Tree Continue invalidates historyId and reloads; Fork opens a distinct registry entry and draft. | Search hit off branch, read-only tree, continuing/forking while cache is hidden. |
| Reading position | b47270b1 removed 573ea0b2's sessionStorage restore policy. Do NOT resurrect it. Kept Activity preserves its existing DOM scroll position, composer, disclosures and drafts. Eviction loses viewport position as today; drafts retain their existing owner. If a future bookmark names an unloaded entry, it must call ensurePosition first, not scroll a missing row. | Scroll up → switch away/back → unchanged anchor. Eviction returns to tail. Browser reload has no saved reading-position contract. |
| Unread boundary | Current unread is a global completion-order receipt, not a per-message marker. Preserve that policy. Receipt capture precedes open and acknowledges only the captured completion. No implied per-turn read ledger or automatic jump to first unread. An explicit future unread entry target uses ensurePosition like search. | New completion after receipt capture remains unread; targeted old passage and cached/hidden reads do not infer a newer completion order. |

Scroll contract: assistant-ui 0.15.28/core ≥0.3.24 supplies `hasEarlier`, `onLoadEarlier`, `ThreadPrimitive.LoadEarlier` and prepend compensation. The store resolves onLoadEarlier only after the prepend is published. Thread owns the viewport. Preserve `turnAnchor="top"`; it anchors the active turn, NOT older history. Use native prepend compensation first. Browser-test a stable visible message ID and its relative y coordinate (≤1 CSS px change), including late Mermaid/code resize and streaming while scrolled up. Do not add competing repair loops. If late growth still moves the anchor, make that a failed acceptance check, not an unmeasured workaround.

Tests: safe start/end boundaries, 0/50/54/oversized-turn cases, absolute positions, search/tree targets, branch replacement, concurrent loads, retry, stable DOM disclosure identity, prepend anchor in each Fold posture and desktop. Never claim happy-dom proves scroll geometry.

## 3. Registry and kept screens

App composition creates one `SessionRegistry`; screens consume entries. No createSessionStore/start/dispose tied to a hidden screen's effects. Key by transport/machine identity + canonical cwd + full session ID. One store per key; prefetch and select share it. Six entries total, including selected and prefetched entries. Selected is never evicted; prefetched entries do not gain visited recency. Evict the least-recently selected hidden entry first; cancel its read, close socket, dispose panel stores and unmount Activity. App close disposes all.

Entry owns SessionStore plus childAgents, processes, workflows, decisions, gatedActions and the one session-ref accessor used by them. Move `onUnread`, PI child/workflow event refresh, processes.update/output refresh, reconnect panel refresh, and store disposal from ForgerieSession to this entry. The view still owns open panels, composer adapters and purely visual state. Attachments/dictation cleanup must distinguish Activity hide from final eviction: hiding cannot permanently dispose an adapter retained by React state. Move irreversible adapter disposal to final entry disposal or recreate adapters deliberately on reactivation. Rehydrating an effect must not overwrite a retained unsent draft or ask answers with initialDraft again.

Keep live connections for all six entries, including hidden/idle ones, until eviction, transport failure, or app close. No 10-second idle close: it would contradict a healthy 10-second zero-request return. Background streaming therefore survives hiding. Prefetch can acquire the open seed and attach the bounded live channel, but never acknowledges. Stop timers/listeners/leases exactly once on eviction. This costs up to six sockets and background update work.

Catch-up: keep the last applied `(epoch,seq)` per entry. A healthy kept select does not reconnect. On transport recovery, subscribe before one `/open` replacement; preserve cached content, unsaved shell rows and identity while it runs. Native replacement checkpoints and classic buffered deltas reconcile above the cut. No new `/messages?after=seq` protocol: the hub has no durable replay log, and a seq is not a message position. Opening an evicted chat is uncached. Commands/panel refresh triggered by actual new events are allowed; simply selecting the kept entry is not a refresh event.

Activity contract: App retains up to six keyed `<Activity mode="visible"|"hidden">` screens. Settings/backlog/triggers/composing must hide, not discard, retained chats. Hidden Activity retains DOM/state but destroys effects and re-runs them when visible. Browser event/recovery subscriptions, store start/dispose, unread visibility and background refresh must live outside it. Audit portal surfaces: hidden chat dialogs must not remain interactive through a body-level portal. A hidden tree may update at low priority; this is not free rendering.

Memory: after GC, page50 whole-page heap was small 18.3, large 18.4, huge 18.8, streaming 18.9 MiB versus full huge 482.2 MiB. **Provisional budget: 16 MiB incremental retained JS heap per kept chat, 96 MiB for six, plus the measured common app heap.** These are whole-page baselines, not incremental six-screen measurements. Acceptance must measure empty-app heap then 1→6 screens; do not multiply the whole-page figure. DOM and native browser memory are extra. Retaining full huge history in six screens is unacceptable.

A deeply paged hidden chat is demoted to its current complete-turn window and unmounted if it exceeds the budget; never trim the selected reader's current content beneath them. Prefer structural loaded-message/byte counts calibrated from the probe; performance.memory is Chromium-specific and not a production eviction dependency. Start hidden retention cap at 200 raw messages plus the current turn; first-page-only screens are below it. Demotion counts as eviction and is not a kept-return claim. A single oversized turn may exceed the provisional heap budget; report it rather than changing the existing safe-turn policy. No precise heap enforcement claim until measured.

Failure/test: duplicate-store prefetch/select, seventh selection, background stream and asks, all six idle sockets, disconnect/daemon restart, Activity hide/reveal effect teardown, settings navigation, draft/disclosure/scroll identity, disposal exactly once, deep-page memory demotion, 6-screen heap growth and portal focus exclusion.

## 4. Read receipts

Selection is explicit registry state, independent of document.visibilityState. A receipt can be acknowledged only while that entry is selected, its transcript is visible, document is visible, and its actual transcript paint completes. Hidden, cached-but-not-selected and prefetched entries never acknowledge. Race check all conditions again after waiting for paint; activation generation invalidates an in-flight acknowledgement wait on switch. Already sent writes cannot be undone; do not send them before the visibility checks. Do not clear unread optimistically.

Use the receipt embedded in open or already captured in picker metadata; remove the extra `/sessions/unread` read from the cold-open critical path. A prefetched receipt is safe but conservative: acknowledge its old order only, never replace it with a later catalog order without showing that later transcript. A healthy cached selection need not send an acknowledgement just to select it. If it holds a pending unseen completion, schedule acknowledgement **after** its visible paint; the zero-request paint assertion stops at paint, and the acknowledgement is an independent guarded write. No newer unseen completion is cleared.

Failure/test: hide during rAF, document hidden, prefetch opens ask/stream, completion between capture and seed, completion while hidden, old catalog epoch, targeted search page, hidden callback onUnread, and acknowledgement rejection. Keep badge and report rejection; no optimistic read state.

## 5. Prefetch

Picker pointer intent after 80 ms dwell, keyboard row focus immediately, and idle (`requestIdleCallback`, fallback cancellable timer) may call registry.prefetch(Session). Existing PickerActions gains optional `onPrefetch(row)` / `onCancelPrefetch(row)`; full-stack owns Picker.tsx so the front-end builder does not touch it. Idle priority: unread then frequently selected (in-memory selection count, recency tie-break). Ignore archived, read-only-unavailable, active or already seeded entries. No global catalog scans per hover.

Two concurrent open requests maximum; selection takes priority, adopts the in-flight promise or aborts a lower-priority speculative request. At most six entries, same registry, no second response cache. Leaving a row cancels queued intent and unshared speculative requests, never a selected store's request. Idle stops when hidden/offline, saveData true, connection effectiveType 2g/slow-2g, or eviction pressure. Prefetch failures are visible on actual select through normal retry; they must not surface unsolicited chat errors or acknowledge reads.

Failure/test: hover leave before dwell, focus hopping, selection racing prefetch, two-request ceiling, abort response arriving late, no read acknowledgement, no new store, and idle cancellation on tab hide.

## 6. Render policy and shared UI seam

`include_virtualization=false`. The huge first-page probe returned 54 messages; main-thread upper bound **145.8 ms**, readable 163.8 ms, 3417 document DOM nodes. This is below the conditional 500 ms render trigger. **Do not build virtualization.** Full-history 18.6 s does not trigger it when first-page work is below 500 ms. Cost: scrolling through many pages still grows React/DOM work; remeasure before later virtualizing. Keep ThreadPrimitive.Viewport, not a custom virtualizer scroll container.

Front-end owns content-visibility/contain-intrinsic-size on finished message containers, stable finished-message memoization and load-earlier presentation. Streaming text/reasoning/tools must continue to update. MarkdownText already hoists most component maps; preserve link scope, safety policy, file-tree and copy controls. Do not memoize against ID alone and freeze a completed tool result or disclosure.

Fixed seam before parallel work:

- `EarlierHistory` in `ui/src/historyPaging.ts`: `{type:"complete"} | {type:"available"} | {type:"loading"} | {type:"failed",message:string}`.
- SessionState gains `earlier: EarlierHistory`; SessionStore gains `loadEarlier(): Promise<void>` and `ensurePosition(position:number): Promise<void>`.
- ForgerieSession passes `hasEarlier: state.earlier.type !== "complete"` and `onLoadEarlier: store.loadEarlier` to useExternalStoreRuntime. It passes `earlier={state.earlier}` to Thread.
- Front-end adds optional `earlier?: EarlierHistory` to Thread; absence means no paging UI (NewSession/fixtures remain valid). Runtime drives ThreadPrimitive.LoadEarlier's action and compensation. The prop describes availability/failure, not a second paging store. Failed retry invokes the same runtime callback.
- Existing `Thread.reveal` signature does not change. Full-stack calls ensurePosition before producing reveal for a not-yet-loaded position. Front-end does not fetch history or edit ForgerieSession.
- `useThreadMessages` and transcript identity are full-stack. `Messages`, `MarkdownText`, `Trace` presentation are front-end. Do not add cross-file dependencies through private hooks.

Load-earlier states must use existing components/tokens and accessible status/error/retry controls. This brief makes no visual design decisions. Front-end reads frontend-design, intrinsic-design and caliper-render; use Caliper parts, capture/read all changed states in light/dark at all four Fold viewports plus desktop. Add a dedicated part if Thread lacks one; report missing Caliper coverage rather than declaring visual acceptance.

Failure/test: finished rows do not re-highlight on unrelated deltas, streaming rows still update, tool completion changes, no offscreen blank content when revealed, load complete/available/loading/failure/retry/end states, keyboard activation, native prepend anchoring and Caliper geometry. CSS skips offscreen layout/paint, not React mount work.

## Verification

Builders add their focused tests, then root `npm test`, `npm run verify:static`, UI `npm run verify`. Run browser acceptance for cold/kept opens, all targets, streaming/asks/shell, scrolling, hidden read receipts and 6→7 eviction. Reuse this fixture harness and add native real-storage route/service tests. First-page fixture measurements alone cannot prove native consistency or a one-request production open. Count all network initiated by kept selection through first paint. Capture request waterfall for uncached transcript seed and keep acknowledgement/commands separate. No deployment or shared-service start during this workflow.

Stop if a consistent native/classic cut or complete-turn paging would require changing ask/shell/read-receipt policy. Do not replace a failed native read with legacy data. Proposed follow-up, medium importance: strengthen readable-last-turn measurement to exact-marker glyph geometry and gather real-storage/device baselines before advertising the 500 ms target.

## Parallel file ownership (fixed before builders start)

These lists are exclusive write ownership, not a request to edit every file. Builders may read each other's files. Architect commits the schemas and Thread's optional typed seam before either starts. Thereafter full-stack owns schema changes, but the frozen seam must not change during parallel work. A file not listed here needs a parent ownership decision before editing; do not both solve a build failure in the other's file.

### full-stack

Server source:

- `src/shared/sessionOpen.ts` (architect seeds envelope/schema factory)
- `src/server/sessions/sessionOpen.ts` (architect seeds server types; implement acquisition here)
- `src/server/sessions/sessionRoutes.ts`
- `src/server/sessions/sessionService.ts`
- `src/server/sessions/piSessionService.ts`
- `src/server/sessions/messagePaging.ts`
- `src/server/sessions/durableParentReadModel.ts`
- `src/server/sessions/durableSessionReader.ts`
- `src/server/sessions/durableParentContracts.ts`
- `src/server/sessions/durableNativeHistory.ts`
- `src/server/sessions/durableParentState.ts`
- `src/server/sessions/durableSessionRuntime.ts`
- `src/server/realtime/sessionEventHub.ts`
- `src/server/sessiond/sessionProxyRoutes.ts`

Server checks (existing or new):

- `src/shared/sessionOpen.test.ts`
- `src/server/sessions/sessionOpen.test.ts`
- `src/server/sessions/sessionRoutes.test.ts`
- `src/server/sessions/piSessionService.messages.test.ts`
- `src/server/sessions/piSessionService.unread.test.ts`
- `src/server/sessions/piSessionService.durable.test.ts`
- `src/server/sessions/piSessionService.processEvents.test.ts`
- `src/server/sessions/messagePaging.test.ts`
- `src/server/sessions/durableParentReadModel.test.ts`
- `src/server/sessions/durableSessionReader.test.ts`
- `src/server/sessions/durableNativeHistory.test.ts`
- `src/server/realtime/sessionEventHub.test.ts`
- `src/server/sessiond/sessionProxyRoutes.test.ts`

Browser data/composition:

- `ui/src/contracts.ts`
- `ui/src/historyPaging.ts` (architect seeds EarlierHistory type)
- `ui/src/sessionRegistry.ts` (new)
- `ui/src/sessionPrefetch.ts` (new)
- `ui/src/sessionStore.ts`
- `ui/src/transcript.ts`
- `ui/src/useThreadMessages.ts`
- `ui/src/readReceipt.ts`
- `ui/src/ForgerieSession.tsx`
- `ui/src/App.tsx`
- `ui/src/ui/Picker.tsx` (prefetch events only; no styling changes)

Browser checks/harness:

- `ui/src/sessionRegistry.test.ts` (new)
- `ui/src/sessionPrefetch.test.ts` (new)
- `ui/src/sessionStore.open.test.ts` (new)
- `ui/src/sessionStore.paging.test.ts` (new)
- `ui/src/sessionStore.test.ts`
- `ui/src/sessionStore.reconnect.test.ts`
- `ui/src/sessionStore.nativeReadModel.test.ts`
- `ui/src/sessionStore.read.test.ts`
- `ui/src/sessionStore.shell.test.ts`
- `ui/src/readReceipt.test.ts`
- `ui/src/transcript.test.ts`
- `ui/src/transcript.search.test.ts`
- `ui/src/transcript.shell.test.ts`
- `ui/src/ForgerieSession.search.test.tsx`
- `ui/src/ForgerieSession.drafts.test.tsx`
- `ui/src/App.search.test.tsx`
- `ui/src/App.archiveNext.test.tsx`
- `ui/src/App.keptSessions.test.tsx` (new)
- `ui/src/ui/Picker.prefetch.test.tsx` (new)
- `scripts/fast-chat-open-server.mjs`
- `ui/scripts/fast-chat-open-baseline.mjs`
- `ui/scripts/fast-chat-open-acceptance.mjs` (new)
- `ui/scripts/fixtures/fast-chat-open.mjs`
- `ui/scripts/fixtures/fast-chat-open.test.mjs`

### front-end

- `ui/src/ui/Thread.tsx`
- `ui/src/ui/Thread.test.tsx`
- `ui/src/ui/Thread.organism.part.tsx` (new Caliper fixture for states)
- `ui/src/ui/Messages.tsx`
- `ui/src/ui/Messages.test.tsx` (new)
- `ui/src/ui/MarkdownText.tsx`
- `ui/src/ui/MarkdownText.test.tsx` (new)
- `ui/src/ui/Trace.tsx`
- `ui/src/ui/theme.css`
- `ui/scripts/load-earlier-acceptance.mjs` (new: prepend geometry and UI states)
- `ui/scripts/finished-messages-acceptance.mjs` (new: render identity/streaming)

### Integration rules

The shared seam is the `EarlierHistory` union, store methods, native runtime options and optional Thread prop defined in section 6. Full-stack must not edit Thread, Messages, MarkdownText, Trace or theme.css. Front-end must not edit ForgerieSession, App, sessionStore, contracts or registry. The architect adds Thread's **type-only** optional `earlier` property before builders start so both branches typecheck independently. Front-end then implements its presentation. Full-stack can pass the prop without waiting for presentation code. No runtime semantics are implemented by the architect's seam.

Neither builder edits package manifests/lockfiles; the architect owns the assistant-ui upgrade. Neither builder edits this brief or ADR during parallel work. Parent handles design changes and integration acceptance. No new dependency, custom viewport, or virtualization without the parent revising this contract.
