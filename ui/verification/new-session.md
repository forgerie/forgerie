# New session

"New session" sits at the top of the session list, as "New Thread" does in the homepage thread list. Press it, or press N while the list has focus. The thread area becomes a new session's composer: the usual input bar, the model and thinking-level picker, and one line above the bar, "Start in forgerie · new-ui-mvp".

| Step | What happens |
| --- | --- |
| Open. | The destination starts where you are: the open session's folder, then the newest session's folder. The URL becomes `?new=<folder>`, so a reload returns to the same composer. The unsent first message survives a reload in this browser. |
| Choose where. | "Start in" opens a window-level list of Forgerie's projects, with search. Pick a project to see its workspaces; a project with one checkout is chosen in one step. Escape steps back, then closes. |
| Choose the model. | The model picker shows Pi's default for that folder. Moving to another folder keeps a chosen model only when that folder offers it. |
| Send. | The header reads "Starting session…" and the bar is disabled. Forgerie creates the session with the shown model and level, sends the first message, and opens the session. The list shows it once Pi saves it. |

## Failures

Nothing is retried. Each failure says which step failed:

| Failure | What you see |
| --- | --- |
| The server refused to start the session (4xx). | "The session did not start: <reason>". The message stays in the bar. |
| The start reply was lost, or the server failed (5xx). | The reason, then "The session may have started anyway. Check the session list before you try again." The message stays in the bar. |
| The session started, but the first message failed. | The new session opens with the message back in its draft and "The session started, but its first message may not have reached Pi". |
| The draft is a `!` shell command. | "Shell commands need a running session." Nothing is sent. |

## Contract and limits

- Reads: `GET /api/projects`, `GET /api/projects/:id/workspaces`, `GET /api/models?cwd=`. Writes: `POST /api/sessions` with `{ cwd, startupToken, modelSpec?, thinkingLevel? }`, then `POST /api/sessions/:id/prompt` with `{ cwd, text }`.
- The session always starts with the model and level the bar shows. Pi's create path can pick a different default than its model list reports, so the client sends both.
- Before a session exists, Pi cannot say which thinking levels a model allows. A reasoning model offers every level, and Pi keeps the nearest one it allows.
- Not built yet: attachments in the first message, Rapidfire (start several without leaving the composer), sending before the session is ready, startup progress beyond "Starting session…", other machines, and adding a project. The old client still does these.
- A slash command as the first message goes to Pi as a prompt. Pi expands skills and prompt templates; built-in commands such as `/compact` do nothing in an empty session.

## Verification

Run from this app directory with the dev server running:

```sh
nix shell nixpkgs#nodejs_22 -c npm run verify
./scripts/new-session-acceptance.mjs
./scripts/new-session-shots.mjs
./scripts/real-new-session-check.mjs
```

Set `APP_URL` when the dev server is not on port 8510, and `FORGERIE_ROOT` when the parent checkout is not two folders up. `real-new-session-check.mjs` starts a session in a scratch folder, sends one short message (normal model usage), and archives it. The other scripts use a local API in the preview and make no API requests.

| Check | Result (2026-10-05) |
| --- | --- |
| Automated checks. | Build, TypeScript, lint, and 607 unit tests passed. New tests cover destination naming and defaults, levels before a session exists, keeping a choice across folders, the create-then-prompt sequence with and without choices, a refused start, a lost start reply without retry, a failed first message, and the view: labels, no attach button, Send, picked model and level, a workspace move with a fresh model read, a one-checkout project, each failure message, a refused `!` command, and the draft across a reload. Picker tests cover the button and N. |
| Browser fixtures. | `new-session-acceptance.mjs` passed 28 combinations: four Fold postures, a 475 × 280 keyboard budget, a 280 × 500 pane, and 275 × 280, closed and with the destination list open, in both themes. Flows: choose a workspace, a model, and send; Escape back and out; a refused start. The draft and the open list survived fold, unfold, and rotation. No API request and no page error. The model, dialog, queue, ask, shell, slash, visual, and picker checks still pass. |
| Visual review. | All 16 posture captures and two 275 × 280 captures were read. The destination line and the input bar stay on screen at every size; the destination truncates before the line wraps. |
| Real session. | `real-new-session-check.mjs` passed against the live backend at folded portrait. `?new=<folder>` opened the composer there with Pi's default model. Low was chosen, Send created and opened the session, Pi started it on the shown model at Low, the reply arrived, and the catalog listed it in that folder. The first run found that Pi's create default differed from the default the composer showed; the composer now always sends the shown model. |

Not verified: a physical Fold.
