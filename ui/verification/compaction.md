# Session compaction

Type `/compact` with optional instructions in the one composer. Command selection only inserts text. Confirm with Send or Enter.

During an active run, the button reads "Queue compaction". Pi owns the queue and starts compaction after the run. Ordinary follow-up messages remain unavailable. During idle work, the button reads "Compact history". Attachments must be removed before running a slash command. Ask mode keeps its own command routing and Enter precedence.

## Status and recovery

| State | Behavior |
| --- | --- |
| Checking. | The command was accepted. The client reads authoritative status without repeating the command. |
| Queued. | The notice shows "Compaction queued". Expand "Queued command" to read the original instructions. Another compaction submission stays disabled. |
| Running. | The notice shows "Compacting history…". Stop reads "Stop compaction". There is no estimated progress. |
| Finished. | `command.output` supplies completion, cancellation, or failure. Completion details retain the full server receipt. Dismiss removes the notice. |
| Outcome unavailable. | An observed operation disappeared without a receipt. The notice reports unavailable completion details instead of inventing success. |
| Disconnected. | The notice and draft remain visible. Mutations stay disabled until the client joins authoritative status again. |

"Clear entire queue" removes **all queued work**, including messages from another client. It does not stop the active run. The count includes every queued item. This is not selective compaction cancellation. Stop aborts active work and returns queued messages to the chat draft in delivery order. If a newer ask is open, restoration waits in the saved chat draft and does not change its answer.

A rejected compaction restores its instructions only when the chat draft remains empty. A newer typed chat draft wins. An open or replacement ask keeps its answer and retains the recovered chat draft until it closes. Mutations never retry automatically. A lost acknowledgement can mean Pi accepted the command. Check live status and history before sending it again.

## Contract and limits

The backend and original Lit client remain unchanged. This private client stays on the unrelated `new-ui-mvp` branch, not `main` or the npm package.

The client consumes validated `status.update` and `command.output` events. Status exposes queued compaction as a `followUp` item whose text starts with `/compact`. Queue clearing uses `/queue/clear`, not `/abort`. The abort response supplies `restoredMessages`.

Operational receipts stay outside transcript messages. They are not persisted. Join buffering retains receipts even below the transcript snapshot watermark. Newer live statuses win over older HTTP responses. Reconnect reads authoritative status without resending a mutation.

The current API has no command ID. Receipt detection therefore depends on Pi's existing completion, cancellation, and failure prefixes. A future backend wording change needs a corresponding contract update. Automatic compaction can finish without a command receipt. Reload does not recover an earlier receipt. An unsent draft survives reload through [draft protection](drafts.md). This is not a general steering or follow-up queue editor.

## Verification

Run from this app directory with the standalone dev server running:

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/compaction-acceptance.mjs
nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/compaction-shots.mjs
```

Set `APP_URL` for another port. Set `SHOT_DIR` to change the screenshot directory. Screenshots use the parent repository's canonical posture script. Set `FORGERIE_ROOT` if the parent checkout moves.

| Check | Evidence |
| --- | --- |
| Automated checks. | Build, TypeScript, lint, and 343 tests passed after rebasing onto the concurrent image-viewer work. |
| State and transport. | Tests cover queue instructions, all receipt outcomes, command acknowledgement races, buffered receipts below history watermarks, stale status reads, queue clearing, abort restoration, disconnect/rejoin, and no mutation retry. |
| Composer and session binding. | Tests exercise explicit buttons and Enter, ordinary-send blocking, ask precedence, one input, failure restoration, and Stop. The two ask-transition regressions failed before the recovery fix. |
| Browser fixtures. | 72 scenario, theme, and size combinations passed. The script checked explicit slash selection, queued/running/completed transitions, queue clearing, preserved drafts across Fold transitions, no overflow, and no API mutations or browser exceptions. |
| Visual review. | Queued, running, and complete captures cover all four Fold postures in both themes. The notice, Stop, queue clearing, completion details, and composer remain reachable. |
| Running client. | After integration, the HTTPS client on `https://zao.hummingbird-lake.ts.net:8510/` passed all 72 fixture combinations again. Read-only real history matched 135 tool calls, 2 failures, and 28 reasoning parts, with no overflow or browser exception. Build, lint, and all 343 tests also passed in the integrated worktree. |

The feature worktree and branch were removed. Only the standalone MVP dev server remains running. Main stays at `96d96310`; no production service restarted.

Independent review found two ask-transition defects in draft restoration. Both regression tests failed before the fix. The follow-up review verified the fixes, session boundaries, and single-attempt mutations, with no further serious finding. The existing ask browser check also passed.

The fixtures use injected state, not network interception. HTTP/WebSocket store tests and the actual ForgerieSession binding cover transport and restoration. Browser checks do not compact a real Pi session or consume model usage. Evidence stays under ignored `verification/local/compaction/` and `/tmp/aui-compaction-final-shots/`.

Costs remain: the notice reduces transcript space, and details take one extra activation. Physical Fold keyboard, touch, and a real model compaction remain unverified. The existing Vite bundle warning remains. No production session daemon restart is required.
