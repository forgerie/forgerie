---
"forgerie": patch
---

Let agents clean up their own throwaway Git work without asking you. The new `scratch_git` tool creates worktrees, clones, branches and new remote branches or tags for a session and its child agents. Removing what it made, including `git branch -D` of its branches, no longer waits for approval. Work the tool did not make still asks. Worktree backups now go to the configured data folder (`PI_WEB_DATA_DIR`) instead of `~/.forgerie`.
