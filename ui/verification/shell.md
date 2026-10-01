# Shell commands

Type `!` and a command in the one composer to run it in the session's working folder. Use `!!` to keep the output out of the agent's context. `!@` stays the all-file mention trigger. The command runs on the existing `POST /api/sessions/:id/shell` endpoint. The backend and the Lit client on `main` did not change.

## Behavior

| Situation | What happens |
| --- | --- |
| Shell draft | A line above the input names the mode and says whether the agent sees the output. The draft is set in the code font. **Run command** replaces Send. Enter runs. Shift+Enter adds a line. File and model completion are off. |
| Agent run in progress | **Run command** stays available next to Stop. The server accepts a shell command during a run. |
| Another command runs | **Run command** is disabled, and the line says why. The header reads "Running shell command". Prompts can still be sent, because the server accepts them beside a shell command. |
| Compaction checking, queued, or running | **Run command** is disabled. The server rejects shell commands during compaction. |
| Attachments in the draft | **Run command** is disabled until the attachments are removed. |
| Ask open | `!command` routes through the ask's chat action. The button reads **Run command**. The questions stay open, because a shell command does not close an ask. |
| Rejected or lost request | The error shows in the session notice. The draft comes back only if the input is still empty. Nothing retries. A lost acknowledgement says the command may have started. |

Each command becomes a shell row in transcript order: a code sheet with the command, its output, and its status. The status is `running`, `exit N`, `cancelled`, `failed`, or `no result`. A non-zero exit and a failure use the error colour. `!!` rows say "excluded from context". Saved results that Pi truncated name the full-output file. Only the output scrolls, inside the same height budget as tool output. While a command runs, the output follows its newest line unless you scroll away from the end. **Copy output** copies the output.

## Contract

The client consumes validated `shell.start`, `shell.chunk`, and `shell.end` events, and the `bashExecution` fields in history. `shell.end.output` replaces the streamed text, because it is the result Pi saves. No message event announces the saved record, so the live row keeps no message key until the next history load.

Joins reuse the existing watermark. A finished command whose events arrived before the watermark is dropped when the history read already returned its record. The observed commands must match the last saved records, in order, by command, output, exit code, and cancellation. Failed commands are left out of that match, because Pi never saves them. If status says a command runs and no event for it arrived, the client shows a running row with the command unknown. A buffered `shell.end` cancels that row, because the socket can deliver the end before the status response arrives. Output fills in from later events, and `shell.end` supplies the full result. The next history load names the command. A replayed row that cannot finish, because no command runs, shows `no result`. If its last events arrive after the join, they reopen and finish that row instead of adding a second one.

Pi saves a command's record only after the agent run ends, when the command ran during a run. No event announces the save. A join therefore keeps a finished row that the history lacks, after the message it followed, with the same identity. The row goes away when a later history load returns a matching record after that message, or when the join replayed the same row. Rows for failed commands stay for the life of the page.

A shell command is not an agent run. `isBashRunning` no longer sets the thread's running state, so Stop and the working indicator belong to agent runs and compaction only. Live output keeps its newest 51,200 characters, which is the size Pi saves.

## Limits

- **Nothing can stop a running shell command from this client.** The abort route calls `session.abort()`, which does not call Pi's `abortBash()`. A command such as `!yes` or `!tail -f` runs until the session daemon restarts. Fixing this needs a backend change on `main`.
- During an agent run, Pi saves the record after the run ends. Once the history returns it, the row shows after that run's messages, not where it appeared live.
- A full page reload during that run loses the row until the run ends, because the record is not saved yet and the page holds no earlier transcript to carry it from.
- Two identical commands with identical output can be mistaken for one at a join, if the second finishes between the history read and the watermark. The next reload corrects it.
- A shell row that a join replaced gets a new identity, so its output scroll position resets.
- Physical Fold keyboard and touch behavior are unverified.

## Verification

Run from this app directory with the dev server running:

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
./scripts/shell-acceptance.mjs
./scripts/shell-shots.mjs
./scripts/real-shell-acceptance.mjs
```

Set `FORGERIE_ROOT` when the parent checkout is not two folders up. `real-shell-acceptance.mjs` creates and archives its own scratch session in a temporary folder. It sends one short prompt, so it costs normal model usage. The other scripts use local fixtures and make no API requests.

| Check | Result |
| --- | --- |
| Automated checks. | Build, TypeScript, lint, and 405 unit tests passed. New tests cover draft parsing, availability, saved records, live events, missed starts and ends, join dedupe, the running placeholder, late join events, failed commands in the dedupe, unsaved rows across a reconnect, store routing, rejections, lost acknowledgements, prompts beside a shell command, the compaction label while only a shell command runs, the row's states, and composer and ask-mode routing. |
| Independent review. | A reviewer found three join defects: a stuck running placeholder, a second row from a late `shell.end`, and failed commands breaking the dedupe. It also found the lost unsaved row after a reconnect during an agent run. Each now has a regression test that failed before its fix. The review's smaller findings were also fixed: the compaction button label, a screen-reader alert on every saved failure, tail-follow at the final output, and copying a failure message. |
| Server trace. | A scratch session confirmed the event order, `seq` values, the record shape, `exit 3` and `exit 127` results, rejection of a second command, the `Usage: !<shell command>` error, and that a command during an agent run is saved after the run. |
| Browser fixtures. | `shell-acceptance.mjs` passed 36 scenario, theme, and size combinations: four Fold postures, a 475 × 280 keyboard budget, and a 280 × 500 pane. It checked no page overflow, one input, header readouts inside the row, no sideways output scroll, reachable controls, Enter to run, live follow and finish, blocked drafts, Run beside Stop, ask routing, and the draft across fold and rotation. No API request or page error occurred. |
| Real session. | `real-shell-acceptance.mjs` ran `!` and `!!` commands, reloaded to see each saved record once, then joined during a running command. The row stayed one row, finished with the full output, and the next load named the command. |
| Visual review. | All 24 captures from the canonical posture script were read in labelled contact sheets: history, a blocked draft beside a running command, and a draft during an agent run, at four postures in both themes. Four extra captures checked the excluded, truncated row at folded portrait and at 280 px. Readouts wrap below the label at 280 px. The copy control stays on the row. |
