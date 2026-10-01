# Draft protection

Unsent text now survives a session switch and a page reload. This covers the chat draft and the partial answers to an open `ask_user` question set. Reconnect and failed-send restoration work as before.

## Behavior

| Case | Result |
| --- | --- |
| Switch to another session and back. | The chat draft returns to its own session only. Another session starts with its own draft or an empty input. |
| Reload the page. | The chat draft returns. An open ask returns on the question that was showing, with its chosen options and typed answers. |
| An ask is open when the page loads. | The saved chat draft waits in the parked slot and returns when the ask closes. It never appears in the answer input. |
| A new ask opens. | It starts blank on its first question. The chat draft is never saved as an answer, not even for one render. |
| The ask closes, even while the page was away. | Its saved answers are dropped once the client joins and the server reports no open ask, or a different one. |
| A message is sent. | The saved chat draft is cleared. A failed send puts the text back, and that text is saved again. The send is never retried automatically. |
| Stop or a rejected compaction restores text. | The restoration order is unchanged, and the result is saved. |
| A `/fork` or `/clone` prompt draft opens a session. | It replaces any draft saved for that session. |
| The session is deleted from the picker. | Its drafts are removed. Late writes from the closing view are ignored. |
| The session is archived. | Its drafts stay, so a restored session keeps them. |

## Storage

`src/draftStore.ts` keeps one `localStorage` record per session, under the key `forgerie.draft.v1:<sessionId>`. A record holds the chat text and at most one ask: its ID, the current question index, and each touched question's options and text. An empty record is removed. Each write reads the record first, so a field written by another tab survives. Each field is validated on its own, so a damaged answer set does not cost the chat draft. Full or blocked storage never throws. The draft then lasts only while the view stays mounted.

`src/chatDraft.ts` decides what the chat draft is: the input text, or the text parked under an open ask. It writes nothing until the saved draft is read back. Without that rule, the empty input of a fresh page would erase the saved draft. `src/ui/useAskMode.ts` restores an ask's saved progress when the ask takes the input. It saves the input's current text, not the render's text, because the render can lag one change behind.

## Verification

| Check | Result |
| --- | --- |
| Automated checks. | `npm run verify` passed the build, TypeScript, lint, and 375 tests after rebasing onto handoff navigation (`8afa0d48`). The draft work added 17: 8 for the store, 3 for chat-draft ownership, and 6 that mount the real `ForgerieSession` against a local WebSocket server and remount it the way a switch and a reload do. |
| Mutation check. | On the final code, four deliberate breaks each failed at least one test: no hydration gate, no stale-answer cleanup, no answer-text restore, and no progress guard. The progress-guard break first passed, so a test now checks that a restore never rewrites saved progress. During development, a stricter test caught a real defect: the parked chat text was saved as the first answer for one render. The current code fixes it. |
| Real browser, real API. | `scripts/draft-acceptance.mjs` passed on 2026-10-01 through a dev server on port 8522, before and after the rebase. It used one scratch session with an open ask, and one existing session opened read-only. It typed a chat draft, switched sessions with the browser's history, answered partly, then went back, forward, and reloaded. Answers returned at all four Fold postures in both themes. The chat draft returned after a reload at all four postures. Skip removed the saved answers. Emptying the input left no draft record. The only API write was the expected `ask/cancel`. |
| Visual review. | The eight restored-ask captures in `verification/local/drafts/` were read one by one before the rebase, and the two tightest again after it. Question 2, its typed answer, Skip, and Send answers stayed inside the composer at every posture, in both themes. |

Two earlier browser runs failed because another Forgerie client archived the scratch session during the run. Archiving closes the session's runtime, and the daemon then drops the open ask without an outcome. The script now reports the server's ask state when a restore wait fails. Two more runs failed on script defects: a reload check that read the old document, and an assumption that picker preferences always exist in storage. Each run used its own scratch session and archived it afterward.

Run it again with:

```sh
APP_URL=http://127.0.0.1:8510/ FORGERIE_ROOT=/path/to/forgerie ./scripts/draft-acceptance.mjs
```

Each run sends one prompt to the default model. The model replies once more after Skip.

## Limits

- Attachments are not kept. They are files, not text. A switch or reload before sending drops them from the composer.
- Drafts are stored as plain text in this browser's storage on this device. They do not follow you to another device or browser. Do not leave secrets in an unsent draft.
- Two tabs that edit the same field of one session's draft follow last-writer-wins. A tab does not pick up another tab's edits while it stays open.
- The original Lit client and this client run on different ports, so they are different origins with separate storage. They do not share drafts.
- A session deleted from another browser or device leaves its record here. Each record is small.
- Physical-device testing on the Fold remains with the user.
