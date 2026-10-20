# Browser session lifecycle

The app retains up to six session entries. Selecting a retained entry reuses its
transcript, socket and draft state. Selection acknowledgement is not transcript
readiness. The correct session's content must be visible before a switch counts
as complete.

The [fast chat open contract](briefs/fast-chat-open.md) defines checkpoint,
paging, read-receipt and retained-screen invariants. This page records the
current panel-read lifecycle.

## Selected and hidden work

Hidden entries keep their live transcript subscriptions. Completions and process
pushes still reach their stores. Hiding does not acknowledge a completion, clear
a draft or discard loaded history. The existing capacity and deep-history
eviction rules still apply.

Connection-ready and child/workflow notifications refresh panels only for the
selected, visible entry. A hidden entry records which panel stores need a
refresh. Selection schedules each pending refresh once. This includes reconnect
recovery; it does not reopen a healthy retained transcript.

The child panel stops its list/transcript polling while its entry is hidden.
It cancels outstanding list/transcript reads and retains the child selection,
last content and draft. Showing it resumes a debounced refresh. A new child read
cancels its predecessor. A late response cannot replace the reopened child's
content or mark a newer available child list unavailable.

Task reads cancel their predecessors. Disposing child/task stores cancels their
reads. These cancellations concern reads, not server-side execution. They do
not retract an admitted mutation. Other panel requests already in flight may
finish after hiding; their existing stale-response guards remain in force.

## First-open ordering

The store still subscribes before reading `/open`. Starting that read before the
subscription boundary could miss classic events. Native socket cuts alone do
not provide the HTTP open's captured unread receipt, read-only status and
worktree metadata. Removing the HTTP read requires a separate contract for
those fields and for sequence coverage. This optimization is deferred.

## Measured effect and limits

A paired run on 2026-10-20 used the native temporary-profile fixture, six idle
sessions of 20 or 300 turns, and normal-network prefetch. Across ten fresh
documents per client, the boot window issued 436 panel reads before this change
and none after it. Visiting all six sessions then issued 394 panel reads at
selection. Net panel reads fell by 10% (436 to 394) in this workload. The
speculative boot reads no longer compete with the first selected open. The
saving grows when prefetched sessions are never visited.

The cost: a prefetched session that was never selected shows its child, process
and task indicators after its first panel read, not at selection.

A follow-up made those selection-time reads wait until the destination
transcript had painted, with a bounded fallback. It was measured and not kept.
Two interleaved runs, each with 100 fresh documents per client, compared the
delay from the first click to a useful frame:

| Comparison | Median (ms) | p95 (ms) | Samples over 400 ms |
| --- | --- | --- | --- |
| Base / paint gate | 166.8 / 169.1 | 599.6 / 604.2 | 13 / 12 |
| Current / paint gate | 170.3 / 172.8 | 502.4 / 515.6 | 10 / 13 |

The differences are within run noise. In the second run the paint gate was
slightly worse than the current behaviour. Host load varied from 2 to 47
during the runs, and load spikes dominated the tail.

The run did not show a latency change. Four 1,000-switch runs alternated base
and candidate clients. Warm-switch p95 varied from 61 to 146 ms with run order
and host load (1-minute load 8 to 24 on 16 cores), not with the client. All
4,000 switches and 600 six-session switches per client passed the identity
guard. The fixture did not reproduce the live timeout after 398 warm switches.
Its histories were 300 turns or fewer, idle and without streaming. Startup
acquired every owner, so opens were warm-owner, not daemon- or OS-cold.

Focused tests cover hidden reconnect refreshes, cancelled and late reads,
child reselection, drafts, completion receipts and transcript paging. These
checks do not establish an end-to-end latency budget or eight-hour memory
stability.
