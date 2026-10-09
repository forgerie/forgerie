# Session worktrees

A new session in a Git project starts in a fresh Git worktree by default: its own folder and branch, made from the project's default branch. Land puts its commits on the default branch; Discard throws them away. Either way the conversation stays readable. The backend contract is Forgerie's `docs/session-worktrees.md` on `main`; this client reads it through one adapter, `src/worktrees/worktreeApi.ts`.

## What it does

| Part | Behavior |
| --- | --- |
| Destination | For a Git project the dialog says "Start in [forgerie · new worktree from main]". The picker lists "New worktree from main" first, then the project's checkouts. Choosing a checkout opts this one session out; the URL keeps `&place=existing`, so a reload keeps the choice. A folder outside Git starts in itself, as before. Nothing is created until Start. |
| Models, skills, files | A fresh worktree starts from the default branch, so the dialog reads them from the main checkout. |
| Setup | After Start, a card shows the steps: create the worktree, run `.forgerie/hooks/worktree-post-create` (only when the repository has one), start Pi. The hook's last lines show while it runs. |
| Setup failure | The card stays with the failed step, its exit code, and the whole saved log, scrolled to its end. The message goes back into the bar. Retry setup runs the setup again in the same worktree and then starts the session; Discard worktree removes it. A failed setup from an earlier visit is listed under the bar, from the server's inventory. |
| While running | The input bar shows the branch with ↑ commits ahead of the default branch and ± uncommitted files. The branch name shortens first, then the counts; the bar's buttons never give way. The session list row shows the same counts. Counts are read when the session opens and when each run ends. |
| Session menu | ⋯ in the session header. It repeats the branch and the counts in full, and holds "Land on main…" and "Discard worktree…". They are disabled, with the reason, while a run, setup, or another owner stands in the way. |
| Land | A confirm step says how many commits land and that nothing is pushed. A dirty worktree is warned about first, because the server refuses it. Success says "Landed on main at <sha>". |
| Conflict | Land says the rebase stopped, nothing changed, and lists the files. "Ask the agent to resolve" sends the server's own prompt to this session. The client edits no file. |
| Discard | The confirm step names what is lost ("4 commits not on main and 2 uncommitted files will be lost") and lists each commit and file. If the work changed since the list, the client reads it again and asks again. |
| Landed or discarded | The session stays in the list and opens. Its row says "landed <sha>" or "discarded". Where the input bar was, a receipt says what happened, that the conversation is read-only, and offers New session. |
| Archive | The server removes a clean, landed, unshared worktree by itself; the client says nothing. If it keeps one, the archive's undo line adds why ("Kept worktree fix-login: it has commits that are not on main. Land or discard it to remove it.") and stays until dismissed. |

Sessions made by `spawn_session`, `spawn_subsession`, handoff, and pi-subagents are not affected: the server keeps them in their parent's folder.

## Verification

From this app directory, with the dev server running (`APP_URL` defaults to port 8512 in the live check):

```sh
nix shell nixpkgs#nodejs_24 -c npm run verify
FORGERIE_ROOT=../.. APP_URL=http://127.0.0.1:8510/ ./scripts/real-worktree-check.mjs
```

The live check makes a disposable repository with a slow post-create hook and drives the real app at folded portrait: the default destination, the hook running, the chip and row counts, a Land conflict and "Ask the agent to resolve", Land with the sha, a reload of the landed conversation, Discard with its commit list, an opt-out to the main checkout, and archive cleanup both removed and kept. It sends real first messages (normal model usage), and the conflict turn lets the agent rebase. It archives and deletes every session it made and removes the repository.

Posture captures use `verification/worktree-preview.html?scenario=<name>` with `scripts/capture-postures.mjs` in the repository root. Scenarios: `new`, `new-picker`, `new-hook`, `new-failed`, `session`, `session-menu`, `land`, `conflict`, `discard`, `landed`, `discarded`, `picker`, `archive-note`.

## Limits

- Counts do not poll. A commit made outside a run (in a terminal) shows on the next open or the next run's end.
- The hook step appears only once the server reports the hook ran, so a repository without one never shows it.
- Archive cleanup is the server's decision; the client shows a kept worktree's reason only when the archive happens while the list is open.
- An unregistered folder opened through `?new=` shows "Commands unavailable" over the dialog. This predates worktrees and also happens on `new-ui-mvp` without this change.
