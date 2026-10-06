# New session

A new session starts from a dialog over whatever is open. Open it with "New session" at the top of the session list, N while the list has focus, or Ctrl+Enter anywhere outside a text field. Ctrl+Shift+Enter opens it in Rapidfire. (Cmd on a Mac.) In a text field, Enter sends and Ctrl+Shift+Enter steers the running agent, so the shortcuts wait until focus leaves it.

The window follows Paperclip's new-task dialog as its own screenshots show it (`docs/pr-screenshots/pap-2837/newissue-*.png` in paperclipai/paperclip). It is a titled window in sections, divided by rules:

1. A header: the Forgerie mark, "New session", and Close.
2. A sentence of chips: "Start in [forgerie · new-ui-mvp] with [Claude Opus 5.5 High]".
3. The writing area, which takes all the height left. Enter is a new line.
4. A row of labelled chips: Attach, Rapidfire, and dictation.
5. A footer: "Discard draft", and the one filled button, "Start session" (Ctrl or Cmd+Enter).

The window keeps a margin while the screen has room and meets each edge as the room runs out, so on a folded phone it is a full-screen sheet with the same sections. In a short window, the header and footer stay put and the middle scrolls. The theme stays this app's.

The first version (2026-10-05) was the chat composer on a tab, with no frame. The user rejected it: it did not carry the weight of Paperclip's window.

## What it does

| Part | Behavior |
| --- | --- |
| Destination | The tab names where the session starts: the open session's folder, then the newest session's folder, then the first project. "Start in" opens Forgerie's projects with search, then the chosen project's workspaces. The URL keeps `?new=<folder>`, so a reload reopens the dialog in the same place. |
| First message | The usual composer: `@` files of the destination, `#` models, dictation, and up to 16 attachments. The unsent message and its text survive closing the dialog and a reload, in this browser only. |
| Files | Small images go with the message. Other files wait in the dialog until the session exists, then the start saves them in the session's folder and names them in the message, as in a running session. |
| Skills and prompt templates | `/` lists the destination's skills and prompt templates. A first message that starts with one runs it through Pi's prompt-resource route with the identity the folder listed. A `/command` the folder does not list is refused and stays in the bar: built-in commands need a running session. |
| Model and thinking level | The picker shows Pi's default for the destination. Moving to another folder keeps a chosen model only where that folder offers it. The session starts with exactly what the picker shows. |
| Send | The session starts and opens. While it starts, the card shows Pi's own startup progress ("Refreshing provider models", for example) or "Starting session…". Escape, the backdrop, and Close wait until the start ends. |
| Rapidfire | The chip in the bar. Send starts the session in the background, empties the bar, and keeps the dialog open for the next one. A list under the card shows each start: its progress, "Started" with Open, or the failure with Put back, which returns the message and its files to the bar. Starts keep going after the dialog closes. |
| Session list | A start shows at once as a Working row named by its first line, with no row menu. Once Pi has created the session and listed it, Pi's own row replaces it. Selecting it before then opens the session if it exists, or the window, where its progress shows. |
| Background failures | A Rapidfire start that fails after the window closed shows a notice over the thread, with Review, which reopens the window and its "Put back". A reload while any start is in flight asks first. |
| Close | Close in the header, Escape, a press on the backdrop, or Back. The draft stays. "Discard draft" clears the text, the files, and the saved copy. |

## Failures

Nothing is retried. Each failure says which step failed:

| Failure | What you see |
| --- | --- |
| The server rejected the request: a missing field, an unknown model, or an unknown thinking level. | "The session did not start: <reason>". The message stays in the bar. |
| Any other failure before the session exists: a lost reply, a 5xx, or a 400 from inside the start. | The reason, then "The session may have started anyway. Check the session list before you try again." The message stays in the bar. |
| The session started, but its files or first message failed. | The session opens with the message back in its draft and "The session started, but its first message may not have reached Pi". In Rapidfire, its row says so and offers Open. |
| A `!` shell command. | "Shell commands need a running session." Nothing is sent. |
| A `/command` the folder does not list, or the list could not load. | The reason. Nothing is sent. Retry from the `/` list. |
| A `/command` sent before the folder's list loaded. | "Still loading. Start again in a moment." Nothing is sent. |

## Contract and limits

- Reads: `GET /api/projects`, `GET /api/projects/:id/workspaces`, `GET /api/models?cwd=`, `GET /api/projects/:id/workspaces/:id/prompt-resource-catalog`, and the workspace file search. Writes: `POST /api/sessions` with `{ cwd, startupToken, modelSpec?, thinkingLevel? }`, then `POST /api/sessions/:id/attachments` for files, then `/prompt` or `/prompt-resource-command`. Progress arrives as `session.startup` events on `/api/events`, matched by `startupToken`.
- The composer's pickers mount inside the dialog. A native modal dialog makes the rest of the page inert, so a picker on the page body could not be used.
- The legacy client also offers other machines as destinations. This client reads only the local machine everywhere, so it cannot open a session it starts elsewhere. Adding a project is still in the legacy client.
- The legacy "inline or folder" choice for attachments is not here. This client decides per file, as it does in a running session.
- Rapidfire in the legacy client allows only the current workspace. Here it follows the tab, because nothing in this client depends on the current workspace.
- Starts in progress live in this browser tab. A reload during a start warns first; after a reload, the list shows the session once Pi saves it.

## Verification

Run from this app directory with the dev server running. Set `APP_URL` when it is not on 8510 and `SHOT_DIR` to keep captures apart from other sessions.

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
./scripts/new-session-acceptance.mjs
./scripts/new-session-shots.mjs
./scripts/real-new-session-check.mjs
```

`real-new-session-check.mjs` starts two sessions in a scratch folder, each with one short message (normal model usage), and archives both. The other scripts use the preview's local API and make no API requests.

| Check | Result (2026-10-05) |
| --- | --- |
| Unit and component tests | Build, lint, and all tests pass. New or rewritten: the start with a token, images, saved files, and a skill identity; a file save failure after the session exists; the folder's skill catalog; startup tokens without a secure context; held files (28 in `newSession.test.ts`); the launch list (5); startup events on the catalog socket (1); and the dialog (18): opening, pickers mounted inside it, closing with the draft kept, every start outcome, the busy lock, a skill sent with its identity, an unlisted command refused, and Rapidfire with its list, Put back, and Open. |
| Fixture browser check | 42 combinations pass: the dialog, the destination list open, and Rapidfire with three starts, at the four Fold postures, a 475 × 280 keyboard window, a 280 × 500 pane, and 275 × 280, in both themes. Every control sits inside the screen once scrolled to, and Start never leaves it. The draft and the open destination list survive fold, unfold, and rotation. No API request, no page error. |
| Visual review | 24 captures (three states, four postures, two themes). Read: the dialog in light unfolded landscape and dark folded portrait, Rapidfire in light folded landscape and dark unfolded portrait, and the destination list in light folded portrait. |
| Real sessions | Against the live backend at folded portrait: `?new=` opened the dialog in the scratch folder with Pi's default model; Low was chosen; Send created and opened the session; Back did not reopen the dialog; Pi started it at Low and the reply arrived. Then Ctrl+Enter opened the dialog over that session, Rapidfire started a second session in the background, the bar emptied, its row went from starting to Started, and the reader stayed on the first session. |
| Independent review (first version) | Two blocking bugs and four smaller ones, all fixed and tested: closing the image viewer closed the whole window; "Put back" in a later window lost or swapped held files; a command sent while skills loaded was called unknown; placeholder rows duplicated Pi's row and offered a menu for a session that did not exist; a background failure was invisible once the window closed; and two quick opens, or a reload, broke Close's step back. |
| Physical Fold | Not tested. |
