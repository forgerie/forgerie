# Sending while working

While the agent works, the one composer can still send. Pi owns the queue. The client sends Pi's `streamingBehavior` and shows the queue that session status reports.

| Action | Control | What Pi does |
| --- | --- | --- |
| Queue a follow-up. | The outlined arrow button beside Stop, or Enter. | Delivers the message after the agent has nothing left to do. |
| Steer the current response. | "Steer", or Ctrl or Cmd+Shift+Enter. | Delivers the message after the current step, before the next model call. |
| Clear the queue. | "Clear entire queue" in the queue's header. | Removes every queued item, including items from other windows. The run continues. |
| Stop. | The filled Stop button, which keeps Send's place. | Stops the run and returns every queued item to the draft in delivery order, ahead of the typed text. |

Shift+Enter still adds a new line. The keys follow assistant-ui's composer.

## When each control appears

| Session state | Queue | Steer |
| --- | --- | --- |
| The agent responds. | Yes. | Yes. |
| A compaction runs, or waits in the queue. | Yes. The message waits behind the compaction. | No. A steer would wait behind the compaction too. |
| Only a shell command runs. | No. Send works as usual: Pi starts the message at once, beside the command. | No. |
| The draft is a `!` shell command and the agent responds. | No. "Run command" runs it beside the agent run. See [shell commands](shell.md). | No. |
| An `ask_user` question is open. | No. Ask mode keeps its own controls. | No. |
| The draft is a slash command. | `/compact` keeps "Queue compaction". Other commands keep their old rule and cannot be sent until the run ends. | No. |

The queue above the composer lists Pi's items in delivery order. Each row names its kind: "Steer", "Follow-up", or "Compaction". Rows wrap so every word stays readable. The list scrolls inside a height budget, so the input stays on screen. A queued compaction is one of these rows, so the compaction notice no longer repeats it.

The design follows assistant-ui's [message-queue element](https://www.assistant-ui.com/elements/message-queue): pending sends sit on the composer's surface above it. Mobbin had no shipped example of a visible send queue, so no screen reference applies. The element's per-item remove and "run now" are not offered, because Pi can only clear the whole queue and cannot move an item between kinds.

## Refusals and recovery

The client refuses some sends before any request. The draft stays, and the message names the reason. These refusals do not say "Check the transcript", because nothing reached the server.

| Refusal | Reason |
| --- | --- |
| "This message is already queued." | Pi silently drops a text-only message that matches one already waiting. |
| "Queued messages are text only." | Stop returns only the text of queued work, so a queued image could be lost. The composer disables Queue and Steer and shows this before a send. |
| "Steering works only while the agent responds." | The state changed between the click and the send. |

A send whose acknowledgement is lost is not retried. Pi can already hold it. Check the queue and the transcript before you send it again.

## Contract and limits

The prompt body adds `streamingBehavior: "followUp" | "steer"` only while the session works. Idle prompts are unchanged. assistant-ui's runtime queue adapter is not used: it would own IDs, edits, and moves that Pi does not support, and it would reroute every send. A steer travels on the message itself, through `composer.send({ steer: true })`.

The queue is only as fresh as the last `status.update`. The backend publishes status after every Pi event, including Pi's own queue updates, so a delivered item leaves the list when the agent takes it. The real-session check below observed this. Queued items carry no IDs, so rows are identified by position and text. The backend and the Lit client on `main` do not change.

Limits:

- Queued messages are text only. Attachments wait until the run ends.
- Slash commands other than `/compact` cannot be queued.
- One queued item cannot be removed, edited, or reordered. Stop returns all of them to the draft for editing.
- Steering cannot be chosen for a message that is already queued.
- The status header still reads "Running". It does not count the queue.

## Verification

Run from this app directory with the dev server running:

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
./scripts/queue-acceptance.mjs
./scripts/queue-shots.mjs
./scripts/real-queue-acceptance.mjs
```

Set `APP_URL` when the dev server is not on port 8510, and `FORGERIE_ROOT` when the parent checkout is not two folders up. `real-queue-acceptance.mjs` creates and archives its own scratch session in a temporary folder. It runs three short agent turns and one stopped turn, so it costs normal model usage. The other scripts use local fixtures and make no API requests.

| Check | Result (2026-10-05, after rebasing onto shell mode) |
| --- | --- |
| Automated checks. | Build, TypeScript, lint, and 467 unit tests passed. A new test covers a `!` draft during an agent run: it offers "Run command", not Queue or Steer. Another covers an ordinary prompt beside a running shell command: it goes out without a queue behavior. |
| Browser fixtures. | `queue-acceptance.mjs` passed 48 scenario, theme, and size combinations. Flows: keyboard and buttons, attachments blocked, Stop restores, and Clear keeps the draft and the run. No API mutation and no page error. `shell-acceptance.mjs` (36) and `compaction-acceptance.mjs` (72) still pass. |
| Visual review. | All 24 captures from `queue-shots.mjs` were read in contact sheets: the queue, a queued compaction, and a draft with attachments, at four Fold postures in both themes. Queue rows wrap, the list scrolls inside its budget, and the input, Steer, Queue, and Stop stay on screen. |
| Real session. | `real-queue-acceptance.mjs` passed against the live backend at folded portrait. Enter queued a follow-up and Ctrl+Shift+Enter queued a steer while the agent ran `sleep 25`. Pi listed both. Pi delivered the steer before the follow-up, and the queue list emptied. Stop during a later run returned the queued message to the draft ahead of the typed text, and Pi never delivered it. |

Not verified: a physical Fold keyboard. Ctrl or Cmd+Shift+Enter needs a hardware keyboard; on a touch keyboard, use the Steer button.
