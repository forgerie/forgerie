# Notes on changes

Press the changes button in the session header. A modal shows the session's git changes, one file under the next. Tap a line, or its line numbers, to select it. Tap another line in the same file to stretch the selection to it. Tap the only selected line again to clear it. Write what the agent should do, then press Add note. The note shows under its last line, and a blue bar joins it to the lines it covers.

Notes wait in the message box as chips: the file name, the lines, and the start of the note. A chip opens the review at its note; its x removes it. The header button shows how many notes wait. Write message closes the review and puts the caret in the message box.

| What you send | What the agent gets |
| --- | --- |
| A message with notes waiting | The message and every note, in one prompt. The notes leave the message box once Pi accepts the prompt. |
| Notes and an empty message box | Send notes sends only the notes. Enter does the same. |
| Notes while the agent works | Queue and Steer carry the notes, the same as a typed message. |
| A slash command, a `!` command, `/compact`, or `/model` | The command runs without the notes. The message box says the notes wait for the next message. |
| An answer to an `ask_user` question or an extension dialog | The answer goes without the notes. |

Edit and Remove on a note in the review change it before it is sent. Escape puts away a note being written, then closes the review. A press on the backdrop closes the review only when no note is being written.

## Layout

The review uses the session tree's modal frame: a centered card while the window has room, which meets each window edge as the room runs out. It is one column of files at every size, so no width or posture changes its structure. File headers stay at the top of the review while their diff scrolls. Long lines wrap, so the review never scrolls sideways and the swipe to the session list keeps working.

Up to 6 readable files open on arrival. With more, only files with notes open. Each file reads its diff when it opens. A diff draws 1,500 rows at a time, with Show more lines below.

On a mouse, a click on a line puts the caret in the note. On a touch screen the keyboard stays down until you tap the note, so it does not cover the lines you still want to tap.

The chips wrap and scroll inside a bounded share of the window height. When the session is shorter than 28rem, they line up in one row that scrolls sideways.

## Contract and limits

The client sends the notes in the `diffAnnotations` field of the existing `POST /api/sessions/:sessionId/prompt`. The server checks them, writes them into the prompt text, and delivers that prompt through its usual queues. The contract and its bounds are in Forgerie's `docs/briefs/2026-10-07-diff-annotation-prompt-contract.md` on `main`. The client does not also write the notes into `text`.

- Each selected line carries its kind, its text without the diff prefix, and only the line numbers its kind has. Hunk and file headers inside a selection are left out.
- The client checks the server's bounds before a note reaches the message box: 16 notes per message, 200 lines per note, 4,096 characters per note and per line, and 65,536 characters in total. A path the server would refuse cannot take a note.
- A note is a copy of the code you read. If the file changes later, the note still goes as written. The review then shows the note at the top of its file and says the code changed. The server tells the agent to check the current code before it edits.
- Notes are kept with the message box draft in this browser, one record per session, so a session switch or a reload keeps them. They are not stored on the server.
- The review reads git through the session's registered workspace (`/api/projects/:id/workspaces/:id/git/status` and `/git/diff`). A folder that is not a registered workspace shows that reason. The review never writes to git.
- A file changed in both the index and the working tree shows as two entries: staged and unstaged. A note names which one it was written on.
- Untracked folders that git lists as a whole, such as another repository, show as one row without a diff.
- Binary files show no lines. Git output stops at 2 MB, and the review says so.
- A note on a file that no longer has changes stays in the message box. Remove it from its chip.
- Forgerie's daemon must run a build that contains commit `5c2675ca` on `main`. An older daemon ignores `diffAnnotations`, so a message would reach the agent without its notes. To check, run a request with an invalid annotation: a current daemon answers HTTP 400 that names `diffAnnotations`.

## Verification

Run from this app directory with the dev server running. Set `APP_URL` if the server uses another port.

```sh
nix shell nixpkgs#nodejs_22 -c npx vitest run src/changes src/ForgerieSession.notes.test.tsx
APP_URL=http://127.0.0.1:8511 ./scripts/changes-shots.mjs
```

`changes-shots.mjs` captures the four Fold postures in both color schemes for four scenarios: `changes` (a placed note), `changes-selecting` (a selection with a note being written), `changes-tray` (three chips in the message box), and `changes-empty`. The preview at `verification/changes-preview.html` uses local fixtures. Nothing reaches Pi or git.
