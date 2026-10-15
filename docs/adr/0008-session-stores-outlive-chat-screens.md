# Session stores outlive chat screens

Status: accepted, 2026-10-14

Forgerie's App owns a six-entry in-memory session registry. The registry creates and disposes session stores and their live connections. A chat screen consumes an entry; it does not create a store on mount. Selection and prefetch share one entry per machine, canonical workspace and full session ID.

App retains the six screens in React Activity. Hidden screens keep DOM, draft and disclosure state, but React destroys their effects. The registry therefore owns live event listeners, recovery, unread visibility and child/process/workflow refresh callbacks outside the hidden tree. All six kept connections remain live until eviction, failure or app close. Selecting a healthy kept screen starts no read and paints on the next frame. A hidden or prefetched screen never acknowledges a read receipt.

An uncached entry receives one consistent open envelope: newest complete-turn page (50 raw messages, expanded to a turn boundary), partial and transient host output, status, guarded pre-read receipt, history identity and transport epoch/seq. Native reads use a read lease and Durable's serialized read-only transaction; separate app and conversation watches are not an atomic cut. A seq is a transport checkpoint, not a message cursor. Reconnect replaces from a new authoritative envelope; it never appends a full history to cached messages.

Production native admission is active-only. `sessiond` composes the reader with active-owner locators and existing-family read leases. Active Durable sessions return `readPath: "native", cut: "native"`; inactive sessions read verified saved files without opening a runtime and return `readPath: "classic", cut: "classic"`. Non-Durable active sessions also use classic cuts. Unconfigured Durable compatibility readers retain `cut: "sequential"` and `statusSeq`. The browser requests native admission by default but consumes the negotiated authority, not the request flag.

The native transaction and replacement stream deliberately exclude pending SDK transcript/status callbacks. They do not require the private AgentEventStream to drain. Messages, native tree reads and replacements use the same committed journal. Host-only status changes cause another native cut; shell/command output, errors and Pi/process notifications keep their side channel. A later host event must not hide an earlier native transcript checkpoint on the client.

Admission freezes before preparation. An inactive-to-active change keeps that request classic; the next read reroutes. A native execution owner that closes before lease acquisition produces an error, never a silent fallback. An acquired read lease retains the family until release.

Older pages use an exclusive position cursor tied to the append-only history identity. Prepend preserves message identity and lets assistant-ui own viewport compensation. Branch movement invalidates the identity. Search resolves an unloaded position before reveal. The old sessionStorage reading-position policy stays removed; retained DOM preserves current reading position only while kept.

Implementation contracts, failure cases, tests and parallel ownership are in [fast-chat-open](../briefs/fast-chat-open.md). There is no IndexedDB cache and no virtualization in this run. The huge 50-message probe expanded to 54 messages and used 145.8 ms main-thread work, below the 500 ms conditional trigger. The full huge fixture used 18.6 s; this supports reducing mounted history, not a claim that the endpoint is faster on real storage.

## Considered options

| Option | Reason |
| --- | --- |
| Store per screen mount | Current behavior. Reopening repeats joins and transcript rendering. |
| Keep only data; remount every screen | Less DOM memory, but repeated markdown/diagram mounts prevent a first-frame return. |
| Unlimited mounted screens | Avoids remounts but retains full huge histories; the full huge baseline held 482.2 MiB JS heap for one page. |
| IndexedDB | Could help reload/offline opens, but adds persistence/eviction/privacy costs and is excluded by this run. |
| Virtualize immediately | Adds scroll ownership and variable-height row complexity. First-page measurements do not require it. |

## Consequences

Six connections and hidden DOM consume memory and background work. Start with a provisional 16 MiB incremental JS heap budget per kept chat (96 MiB for six, plus the app); verify with a six-screen measurement. Deeply paged hidden screens may be demoted and evicted, so they lose the kept-return guarantee. A selected screen is never trimmed beneath its reader. Oversized indivisible turns retain the existing explicit native limit failure.

The open endpoint needs a real atomic acquisition seam, not Promise.all over old endpoints. Native committed checkpoints must not reuse per-watch revisions or per-attachment epochs. This is more server work than bundling three JSON replies, but it keeps asks, shell output and read receipts safe.

Cold native admission is deferred. The pool currently retains the first family's `HarnessOptions`. A cold read attachment could otherwise supply empty/default registry/settings/environment to a later execution runtime. Supporting cold native reads requires an execution-options upgrade/lifetime redesign. Active-only admission costs continued classic projected-file reads for inactive sessions and does not solve that pool limit.

The baseline excludes actual storage and native runtime latency. Streaming and revisit failed strict 15% repeatability. No speedup claim may use those cases until comparable baseline and changed runs meet the measurement gate.
