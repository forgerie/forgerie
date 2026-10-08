# Notes on changes

Press the changes button in the session header. A modal shows the session's git changes, one file under the next. Each file is a read-only code editor: syntax colour, old and new line numbers, and the whole file, with unchanged code far from a change folded away. Tap a line's numbers to select it; with a finger, a tap on the line's text does the same. Tap another line in the same file to stretch the selection to it. Tap the only selected line again to clear it. Write what the agent should do, then press Add note. The note shows under its last line, and a blue bar joins it to the lines it covers.

With a keyboard, the editor works like any read-only editor: click or Tab into it, move with the arrow keys, select with Shift, copy with Ctrl+C. Enter starts a note on the lines the caret or selection covers. A screen reader hears the kind of each line, such as "added line 12", as the caret moves.

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

Up to 6 readable files open on arrival. With more, only files with notes open. Each file reads its diff when it opens. The editor draws only the lines near the window, so a long diff needs no Show more.

Unchanged code more than 3 lines from a change folds into a "Show N unchanged lines" bar; a run shorter than 4 lines stays open. Lines under a note never fold. A press on the bar opens that run. Removed lines take their colour from the old file and added lines from the new one, so a comment or string that the change opens or closes colours each side correctly. File types that CodeMirror's language list does not know stay plain, and so does a diff over 1,000,000 characters.

On a mouse, a click on a line's numbers puts the caret in the note, and a click on the text places the editor's caret. On a touch screen the soft keyboard stays down: the editor asks for none, and the note's keyboard waits until you tap the note, so it does not cover the lines you still want to tap.

CodeMirror and its parsers load when a review first shows a diff, as a separate 321 kB file (104 kB compressed). Each language's parser loads the first time a file of that type opens.

The chips wrap and scroll inside a bounded share of the window height. When the session is shorter than 28rem, they line up in one row that scrolls sideways.

## Contract and limits

The client sends the notes in the `diffAnnotations` field of the existing `POST /api/sessions/:sessionId/prompt`. The server checks them, writes them into the prompt text, and delivers that prompt through its usual queues. The contract and its bounds are in Forgerie's `docs/briefs/2026-10-07-diff-annotation-prompt-contract.md` on `main`. The client does not also write the notes into `text`.

- Each selected line carries its kind, its text without the diff prefix, and only the line numbers its kind has. Hunk and file headers inside a selection are left out.
- The client checks the server's bounds before a note reaches the message box: 16 notes per message, 200 lines per note, 4,096 characters per note and per line, and 65,536 characters in total. A path the server would refuse cannot take a note.
- A note is a copy of the code you read. If the file changes later, the note still goes as written. The review then shows the note at the top of its file and says the code changed. The server tells the agent to check the current code before it edits.
- Notes are kept with the message box draft in this browser, one record per session, so a session switch or a reload keeps them. They are not stored on the server.
- The review reads git through the session's registered workspace (`/api/projects/:id/workspaces/:id/git/status` and `/git/diff?context=full`). A folder that is not a registered workspace shows that reason. The review never writes to git.
- `context=full` asks the server for every unchanged line as context, so the review can unfold the whole file. Forgerie's server must run a build of `main` that has this option. An older server ignores it and sends git's usual 3 lines; the review then shows each hunk header where the diff leaves lines out, and folds nothing.
- A file changed in both the index and the working tree shows as two entries: staged and unstaged. A note names which one it was written on.
- Untracked folders that git lists as a whole, such as another repository, show as one row without a diff.
- Binary files show no lines. Git output stops at 2 MB, and the review says so.
- A note on a file that no longer has changes stays in the message box. Remove it from its chip.
- Forgerie's daemon must run a build that contains commit `5c2675ca` on `main`. An older daemon ignores `diffAnnotations`, so a message would reach the agent without its notes. To check, run a request with an invalid annotation: a current daemon answers HTTP 400 that names `diffAnnotations`.

## Verification

Run from this app directory with the dev server running. Set `APP_URL` if the server uses another port.

```sh
nix shell nixpkgs#nodejs_22 -c npx vitest run src/changes src/ForgerieSession.notes.test.tsx
APP_URL=http://127.0.0.1:8511 ./scripts/changes-acceptance.mjs
APP_URL=http://127.0.0.1:8511 ./scripts/changes-shots.mjs
```

`changes-acceptance.mjs` drives real mouse, touch, and key input at the four Fold postures in both color schemes. It checks that each line number sits within 1 CSS pixel of its line after notes and folds, that a fold opens, that a finger tap selects without focusing the note, that a mouse on the numbers focuses the note, that Enter and Shift+Down make a note on the caret's lines, that the review never scrolls sideways, and that a chip opens the review at its note with focus on it.

`changes-shots.mjs` captures the four Fold postures in both color schemes for four scenarios: `changes` (a placed note), `changes-selecting` (a selection with a note being written), `changes-tray` (three chips in the message box), and `changes-empty`. The preview at `verification/changes-preview.html` uses local fixtures; the two modified files are full-context diffs in `verification/changes-fixtures/`, made with `git diff --unified=2147483647` as the server makes them. Nothing reaches Pi or git.
