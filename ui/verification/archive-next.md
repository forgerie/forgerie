# Archive and next

The archive button in the session header archives the open session and opens the next session that wants you. Press it again to keep going. When nothing else waits, the session closes and the session list opens.

The next session is the first of these, in this order:

1. Blocked on you: an `ask_user` question or an extension dialog waits.
2. Errored: the last turn ended in an error.
3. Unread: the session finished a turn you have not read.

Within each group, pinned sessions come first, then the newest. Working sessions and plain open sessions do not count. This matches the Lit client's `triageQueue`.

The archive uses the same write and the same undo offer as the row menu. The offer stays for 5 seconds. While the session list is closed, the offer also shows under the header, over the transcript, so Undo stays in reach. Undo restores the session but does not reopen it.

## When the button is disabled

The button stays in the header and shows why in its title:

| Reason | Cause |
| --- | --- |
| Stop the run first | The session streams, compacts, or runs a shell command. The server refuses the archive then. The live session status decides this, so the button waits even before the list hears about the run. |
| Unpin to archive | The server refuses to archive a pinned session. |
| Already archived | The session is archived. |
| Loading sessions | The session list has not loaded yet. |
| Archiving | An archive of this session is in flight. |

If the server refuses anyway, nothing moves, and the reason shows in the message line until you dismiss it.

## Limits

- This client never marks a session read. A session you open from the queue stays unread until you archive it. The Lit client marks a session read when you open it. This gap existed before this change.
- The next session is chosen from the list as it was when you pressed the button.
- There is no keyboard shortcut in the thread. The session list still archives the selected row with E.
- The undo offer covers the top of the transcript for up to 5 seconds. It does not cover the composer.
- The title is the only place that shows why the button is disabled. On a touch screen, a title does not appear.

## Verification

Run from this app directory with the dev server running. Set `APP_URL` if the server uses another port.

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
SESSION_ID=<idle session whose current entry is not a user message> \
  nix shell nixpkgs#nodejs_22 nixpkgs#chromium -c node scripts/real-archive-next-check.mjs
```

`real-archive-next-check.mjs` never archives `SESSION_ID`. It forks the session at its current entry, opens the fork, presses the button, and checks that the fork is archived, that the app opened another session or the list, and that the undo offer shows. The fork stays archived. It sends no prompt.

| Check | Result (2026-10-05) |
| --- | --- |
| Unit and component tests | Build, lint, and all tests pass. New tests: the queue order and availability (4), the archive result (1), and the whole flow in `App` (6): walk three sessions to the list, undo from the thread, a refusal, a double press, a reader who moves on during the archive, and a running session. An independent review found no blocking bug. |
| Real session | A fork of `01a0d563…` was archived. The app opened the next waiting session, "UI Test OK", with the undo offer under the header. The original stayed unarchived. |
| Header postures | Captured at all four Fold postures in both color schemes. The title shortens; the tree and archive buttons stay in place. |
| Physical Fold | Not tested. |
