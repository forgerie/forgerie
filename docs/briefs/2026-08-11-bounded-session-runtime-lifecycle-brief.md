---
date: 2026-08-11
topic: bounded-session-runtime-lifecycle
artifact: brief
---

# Bounded Session Runtime Lifecycle

## Chosen Thing

Give the session daemon one bounded lifecycle policy for Pi session runtimes. The policy keeps selected chats and real background work alive, retains only two recent disposable runtimes, and automatically retires older idle runtimes without applying the destructive semantics of the user-facing Stop action.

## Users and Context

This is for a Forgerie user who moves through many sessions in one or more connected browser tabs. The user expects the selected chat to stay responsive. The user also expects agents, queued work, dialogs, delegated agents, and managed processes to continue after navigating away.

The daemon currently opens full runtimes for status and stream-snapshot access. It does not retire them when navigation or tab closure removes browser interest. A measured 24-selection probe increased active runtimes from 9 to 17 and daemon RSS from 412,880 KB to 492,000 KB. A previous daemon process reported a 10.5 GB memory peak.

## Goals

- Bound disposable idle runtimes independently of how many sessions the user visits.
- Keep every chat selected in a connected browser warm.
- Preserve agent work and runtime-owned background work when the user navigates away.
- Retire quiescent runtimes without clearing notifications, open `ask_user` forms, or other daemon-owned state.
- Keep the user-facing Stop action destructive and explicit. Do not use it for automatic resource management.
- Make retirement race-safe against runtime startup, HTTP operations, socket lease changes, runtime rebinding, and work that starts during eligibility checks.
- Make the policy observable enough to verify the runtime and memory bound in a real daemon.

## Non-Goals

- Client-side cancellation of obsolete navigation requests. That is a separate containment fix.
- Transcript windowing or large-transcript render optimization. That remains separate work.
- A total cap on connected chats or sessions doing real work.
- Durable managed-process history. Completed process logs and controls can expire with the runtime.
- Runtime eviction based on browser tab visibility, viewport size, or device type.
- Changing the meaning of Abort or Stop.

## Constraints

- A session-specific event socket is the browser lease signal. The selected session has the socket; changing selection closes the old socket and opens the new one.
- Multiple connected browsers can lease the same runtime. Retirement requires the lease count to reach zero.
- A lease protects an existing or opening runtime but does not need to create a runtime by itself.
- Protected work does not consume either slot in the recent-idle pool. The daemon must never cancel user work to enforce the pool bound.
- Runtime startup and every operation that uses a runtime need transient ownership. Retirement must wait until these operations release ownership.
- Eligibility must be rechecked against the same runtime identity immediately before teardown. A runtime that gained a lease or work must remain active.
- Automatic retirement needs a dedicated teardown path. It must not call the current destructive `stop()` / `closeActive()` behavior that clears notifications, asks, dialogs, queues, and live state.
- Notification generations must become unable to accept stale runtime callbacks after retirement while their daemon-owned inbox records remain available for a later runtime generation.
- An open `ask_user` form is daemon-owned and does not protect a runtime. Submitting or dismissing it can reopen the runtime and deliver the outcome.
- An open extension dialog protects its runtime because its unresolved Promise is inside extension code in that runtime.
- Running managed-process states are `running`, `terminating`, and `terminate_timeout`. Any of these states protect the runtime.
- Completed managed-process output is available only while the runtime is connected or warm. Transcript evidence remains after retirement.
- Automatic session-title generation protects its runtime until the title request settles.
- The existing quasi-upstream model applies. This lifecycle is Forgerie product behavior and must not be replaced by an upstream merge.

## Success Criteria

- After switching through 24 otherwise idle sessions with one selected chat, the daemon converges to no more than one leased runtime plus two unselected recent-idle runtimes.
- An unselected disposable runtime stays warm only while it is one of the two most recently used entries and is younger than two minutes.
- The two-minute age is a maximum, not a guarantee. A third newer disposable runtime can retire the least-recent entry earlier.
- Runtime startup, in-flight runtime operations, and retirement are single-flight per session identity. No operation receives a runtime that retirement has detached or disposed.
- Closing the final socket makes an otherwise quiescent runtime eligible for the recent-idle pool. Reconnecting before teardown cancels its retirement.
- Navigating away does not interrupt streaming, compaction, shell work, queued messages, session/tree mutations, delegated agents, open extension dialogs, running managed processes, or title generation.
- A session waiting only on `ask_user` can retire. Its form remains visible through daemon-owned status/catalog state, and a later answer or dismissal reaches the model after runtime reopen.
- Automatic retirement preserves retained notifications. Reopening the session does not erase them, and callbacks from the retired generation cannot append new notifications.
- A user-requested Stop continues to clear queues and runtime-owned interaction state according to its current contract.
- Completed managed-process history can disappear after retirement; running or terminating processes cannot.
- Heartbeat work converges with active runtime count instead of growing with every visited session.
- A repeat of the real 24-selection probe shows a bounded active-runtime count and no monotonic daemon RSS increase attributable to retained idle runtimes.

## Candidate Shapes

### Shape A: Connected leases plus bounded recent-idle LRU

Each session socket contributes a lease. Protected runtime work contributes separate protection. Unleased and unprotected runtimes enter a two-entry least-recently-used pool and expire after at most two minutes.

**Strengths:** Gives visible chats clear ownership, keeps quick A ↔ B navigation warm, and gives disposable runtimes a hard steady-state bound. It separates user work from cache policy.

**Weaknesses:** Needs lease plumbing, transient operation ownership, a retirement coordinator, and a non-destructive teardown path. Abandoned but still connected tabs can each retain one runtime.

**Trade-off:** Accept bounded per-connected-chat retention to avoid cold-starting the chat the user is reading.

### Shape B: Work-only protection

Retire every runtime that has no protected work, even when a browser is displaying the chat.

**Strengths:** Gives the lowest idle memory use and needs no browser lease contract.

**Weaknesses:** The visible chat can become cold while the user reads it. Controls, status, and reconnect handling can repeatedly reopen the runtime.

**Trade-off:** Prefer the tightest memory bound over selected-chat responsiveness.

### Shape C: Time-only warmth

Keep runtimes for a fixed time after access, independent of connected browser selection, with no small LRU bound.

**Strengths:** Has a simpler ownership protocol and makes recent revisits fast.

**Weaknesses:** Rapid navigation can retain many runtimes until the timer expires. A fixed timer does not express whether a browser or background task still owns the runtime.

**Trade-off:** Prefer implementation simplicity over a clear resource bound and ownership model.

## Chosen Shape

Choose **Shape A: Connected leases plus bounded recent-idle LRU**.

It is the only candidate that matches both product expectations: a selected chat stays responsive, and visiting many chats cannot retain one disposable runtime per session. Runtime work is protection, not cache residency. This means the policy can reclaim idle memory without stopping anything the user asked Forgerie to continue.

The policy has four conceptual runtime states:

| State | Ownership | Retirement behavior |
| --- | --- | --- |
| Opening or in use | Startup or transient operation ownership | Never retire |
| Leased | At least one selected-session socket | Keep warm; does not consume the idle pool |
| Protected | Runtime-owned work is active | Keep alive; does not consume the idle pool |
| Recent idle | No lease, operation, or protected work | Keep only if in the two-entry LRU and younger than two minutes |

A runtime can have more than one ownership reason. Retirement starts only when all ownership reasons are absent and the runtime loses or ages out of the recent-idle pool.

Protected work includes:

- streaming agent work;
- compaction;
- foreground shell execution;
- steering, follow-up, and compaction queues;
- session-entry mutations, tree navigation, and tree-exclusive operations;
- delegated agents that still report working;
- open extension dialogs;
- managed processes in `running`, `terminating`, or `terminate_timeout`;
- automatic session-title generation.

An open `ask_user` form is deliberately excluded because it already terminates the run and moves the wait into daemon-owned state.

## Key Decisions

- **Connected selected chats hold leases:** The selected chat stays warm in every connected browser.
- **Use a two-entry, two-minute LRU:** Quick backtracking remains warm while rapid session switching has a small steady-state bound.
- **Protected work sits outside the LRU:** The daemon does not cancel real work to meet a cache limit.
- **Retirement is not Stop:** Automatic resource management gets a dedicated quiescent teardown contract.
- **Preserve daemon-owned asks:** An unanswered `ask_user` form can outlive its runtime and wake a reopened runtime later.
- **Protect extension dialogs:** Their parked Promises cannot survive runtime disposal.
- **Protect live managed processes only:** Completed process output can expire from the Processes panel after retirement.
- **Protect title generation:** Navigation must not silently prevent an automatic session name.
- **Keep client cancellation separate:** It reduces obsolete work but does not solve daemon runtime ownership.
- **Verify with the real stress probe:** Unit state-machine tests alone do not prove that runtime count and RSS converge.

## Open Questions

- Planning must choose the narrow module boundary for lease accounting, transient operation ownership, LRU policy, and teardown orchestration.
- Planning must define the exact introspection/log fields used to report leased, protected, recent-idle, retiring, and retired counts without exposing private session content.
- Planning must decide whether the two-minute maximum is fixed product policy or an operator configuration with this value as the default. The first implementation should not add configuration unless tests or deployment needs require it.

## Next Step

- Create an implementation plan from this brief.
- Treat the client navigation-cancellation fix and transcript windowing as separate work items.
