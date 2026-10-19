---
"forgerie": patch
---

Reuse each worktree's ahead, behind and dirty-file counts for 10 seconds. Session lists, project views, heartbeats and child summaries all asked git for the same three numbers, six `git` child processes per active worktree per read, each started from sessiond's main thread. With 211 active worktrees this was about 19% of the main thread. A rename, land, discard or cleanup of the worktree discards the held counts at once; a commit or edit made inside the worktree can show up to 10 seconds late in those counts.
