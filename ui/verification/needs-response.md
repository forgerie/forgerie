# Needs your response

The picker requires an explicit response request: `reply` or `questions`.
A missing `end_turn` declaration is not a request. The backend can still send
`needs-response` with reason `undeclared`; the picker treats that as ordinary
work, so Unread clears after the conversation is viewed. This rule applies to
both cached session listings and live status events. The picker does not
classify text. `blocked` remains the internal group key so saved preferences
still work.

Cost: if the agent forgets to declare a real question, the completion appears
only as Unread. Open forms and extension dialogs still require a response.

A form or extension dialog has the highest actionable priority. Otherwise the
picker ranks an error before active work, then a response request, then Unread.
Opening a conversation acknowledges Unread after history loads and paints. It
does not close its form or clear its response request.

## Read acknowledgement

`src/readReceipt.ts` reads the server's catalog epoch and completion order before
loading history. After history renders, it acknowledges only that completion.
A newer completion cannot be cleared by an older receipt. The server owns the
read flag. The client waits for catalog events instead of clearing it locally.

The active conversation reloads when new unread work arrives. A notification
that arrives during its initial load schedules another load. Reconnection and
foreground recovery fetch a new boundary. Closing the conversation cancels its
receipt and removes its observer. Hidden pages do not acknowledge.

The two read requests have a 10-second timeout. A read failure leaves Unread in
place and does not prevent the conversation from loading.

Tests cover the guarded receipt, paint cancellation, stale history, completion
during initial loading, observer teardown, and the independent response request.
Picker regressions cover an undeclared completion moving from Unread to Open
when its read event arrives. Explicit reply and question requests stay flagged.

## Visual checks

Use the deterministic fixture:

```sh
APP_URL='http://127.0.0.1:8510/verification/worktree-preview.html?scenario=response-picker' \
OUT=verification/local/explicit-response \
nix shell nixpkgs#nodejs_24 nixpkgs#chromium -c node scripts/picker-shots.mjs
```

The fixture includes an explicit request, active work, an unread undeclared
completion, and an already-read undeclared completion. Only the explicit
request appears under Needs your response. The unread undeclared completion
appears under Unread; the read one appears under Earlier today.

All four Fold CSS viewports and 1280 × 860 were captured in light and dark.
All ten PNGs were read and reviewed. The response heading and count fit. There
were no page exceptions or horizontal page overflow.

The raw overflow counter reports one selected row. Its expanded menu hit area
extends 6 CSS pixels into the list padding. The label, visible menu button, and
page remain inside their containers. This is not a clipped response heading.
The report now names the overflowing node instead of giving only a count.

Captures and the report are local ignored files under
`verification/local/explicit-response/`. These checks use Chromium emulation of
the measured Fold viewports. They do not claim a physical-device check.

## Deployment limit

The backend adds `end_turn` and durable question events. Its undeclared-run
fallback is not an explicit response request in this client. Older unenrolled
turns stay legacy. The terminating declaration consumes output tokens. Accepted form
answers use at-least-once recovery, so a crash during delivery can cause a retry.

The backend must run the new build for response declarations to appear. Building
`main` does not replace sessiond's loaded code. Restart the two backend units
only when agent runs are idle:

```sh
systemctl --user restart forgerie-sessiond.service forgerie-web.service
```
