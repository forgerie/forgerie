---
"forgerie": patch
---

Use `.worktrees/` for new worktrees without moving existing checkouts. Add an automatic cleanup job and a read/run API that reports why owned checkouts stay: dirty files, unmerged commits, live use, unfinished setup, changed checkouts, or errors. Automatic and archive cleanup preserve ignored files, including private files and dependency folders.
