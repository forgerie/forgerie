---
"forgerie": patch
---

Ask for approval less often when agents land work from their own worktrees. The gate now follows each `cd <path> &&` in a command, including one later in the chain or with a redirect such as `2>/dev/null`. A land command (`cd <worktree> && git commit … && cd <main> && git merge --ff-only … && git worktree remove .worktree/<name>`) therefore reaches the existing rule for disposable worktrees, which backs up the files before it removes the worktree, instead of waiting for you. Pushes and merges to shared branches, and destructive commands in the main checkout, still ask.

Some commands that ran without approval before now ask first, because the gate could not tell which folder they ran in: Git commands inside `if … then … fi` or a loop, a `cd` inside `if` or a loop, `pushd`, a heredoc or `$(…)` that runs before a later `cd`, and `bash -c` after a `cd … ||`.
