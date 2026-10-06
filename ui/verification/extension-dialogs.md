# Extension dialogs

When a Pi extension calls `ctx.ui.confirm()`, `ctx.ui.select()`, or `ctx.ui.input()`, the question appears on top of the one input bar, the same way `ask_user` questions do. The head names the source, "Extension", so it is never mistaken for the agent. The header reads "Waiting for you" until every dialog is answered or skipped.

| Kind | How you answer | The input bar |
| --- | --- | --- |
| Confirm | Yes or No, below the message. | Stays the chat input. Typing sends an ordinary message. |
| Select | Tap a choice. | Stays the chat input. |
| Input | Type the answer, then Enter or "Send answer". The text goes to the extension exactly as typed: `!`, `/`, and queueing do not apply. | Takes the input. The chat draft is set aside and comes back when the dialog closes. Attachments are off. |

Every kind has Skip, which closes the dialog without an answer. The extension sees a cancel: `false` for confirm, and no value for select and input.

When the daemon set a deadline, the head shows it, for example "Closes in 4m 32s". The countdown is display only and is not announced. The daemon closes the dialog at the deadline, and status then drops it.

## Several open questions

- Several dialogs can be open at once. The bar shows the oldest, with "1 of 3". Answering it shows the next.
- An open `ask_user` question goes first. While it is open, the bar says "An extension also asks something. It shows after these questions." The dialog then appears.
- A screen reader hears "An extension asks: <title>" for each new dialog, from a live region that stays mounted.

## Contract and limits

- Open dialogs come from `status.pendingDialogs`. The daemon publishes status right after every open and close, so the client does not use the `dialog.opened` and `dialog.closed` events. A reload shows the same open dialogs. A dialog of a kind this client does not know is left out, and the rest still show.
- Answers go to `POST /api/sessions/:id/dialogs/answer` with `{ cwd, dialogId, value }`. Skip goes to `POST /api/sessions/:id/dialogs/cancel`. Both return status. `stale` means another window or the deadline closed the dialog first. It is an ordinary race, not an error.
- The daemon checks answers. A refused answer keeps the dialog open and shows the daemon's message. A lost acknowledgement is never retried. The message says the answer may have reached the extension.
- Slash commands now wait for Pi with no client timeout. An extension command can wait for the user to answer its dialogs, and the old 20-second timeout reported a working command as failed.
- An input dialog's typed answer is not saved across a reload or a session switch. The chat draft is.
- The settled outcome ("Answered: Yes") is not kept as a record. The old client showed it as a dismissable card.
- The SDK cannot tell an extension that a dialog timed out rather than being skipped. See parking-lot item `01M1G357D22DV4R6TXX19CNH04` on `main`.

## Verification

Run from this app directory with the dev server running:

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
./scripts/dialog-acceptance.mjs
./scripts/dialog-shots.mjs
./scripts/real-dialog-check.mjs
```

Set `APP_URL` when the dev server is not on port 8510, and `FORGERIE_ROOT` when the parent checkout is not two folders up. `real-dialog-check.mjs` creates a scratch folder with the test-only extension `scripts/fixtures/dialog-probe-extension.ts`, creates a session there, and archives it afterwards. It sends one short prompt, so it costs normal model usage. The other scripts use local fixtures and make no API requests.

| Check | Result (2026-10-05) |
| --- | --- |
| Automated checks. | Build, TypeScript, lint, and 570 unit tests passed. New tests cover status parsing, an unknown dialog kind, answer, cancel, a stale close, a refused answer, a lost acknowledgement without retry, a double answer, a command that waits on a dialog past the old timeout, the countdown, and the composer: confirm, select, input with the chat draft set aside and restored, literal input text, the length limit, Skip, the count, the countdown, sending and offline states, a refusal, and an ask going first. |
| Browser fixtures. | `dialog-acceptance.mjs` passed 60 scenario, theme, and size combinations: four Fold postures, a 475 × 280 keyboard budget, and a 280 × 500 pane. It checked no page overflow, one input, and the question, every control, and the first choice on screen. Flows: three dialogs in turn (Yes, a choice, typed text, with the chat draft restored), Skip, a refusal, and an ask going first. A typed answer survived fold, unfold, and rotation. No API mutation and no page error. The ask, slash, shell, queue, model, compaction, mentions, skills, and visual fixture checks still pass. |
| Visual review. | All 40 captures from `dialog-shots.mjs` were read in contact sheets: confirm, select, input, three open dialogs, and a dialog behind an ask, at four Fold postures in both themes. The review found select choices that read as plain text; they now have an outline. At folded landscape the choice list scrolls inside the layer, with the next row cut off to show more exists. |
| Real session. | `real-dialog-check.mjs` passed against the live backend at folded portrait. `/dialog-probe` opened a real confirm in the input bar, and a reload showed it again. Yes answered it, Skip closed the select, and the input dialog took the input. The extension received `{ confirmed: true, target: null, name: "probe-1" }`, the chat draft came back, and the command did not fail after 25 seconds of waiting. |

Not verified: a physical Fold.
