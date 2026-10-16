---
"forgerie": patch
---

Agents no longer wait for your approval to discard files in throwaway trees. `git reset --hard`, `git clean`, discarding checkouts and restores, and `git worktree remove --force` run at once in a scratch clone under `/tmp` or in one of the session's child worktrees. The same commands in your project still ask first, and so does deleting a branch anywhere.
