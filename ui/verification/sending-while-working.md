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
| Only a shell command runs. | No. Stop only. | No. |
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

The queue is only as fresh as the last `status.update`. The backend publishes status after every Pi event, including Pi's own queue updates, so a delivered item should leave the list when the agent takes it. This comes from reading the backend code; no live session was observed. Queued items carry no IDs, so rows are identified by position and text. The backend and the Lit client on `main` do not change.

Limits:

- Queued messages are text only. Attachments wait until the run ends.
- Slash commands other than `/compact` cannot be queued.
- One queued item cannot be removed, edited, or reordered. Stop returns all of them to the draft for editing.
- Steering cannot be chosen for a message that is already queued.
- The status header still reads "Running". It does not count the queue.
