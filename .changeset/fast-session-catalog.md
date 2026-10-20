---
"forgerie": patch
---

Load the session list in a fraction of the time. Matching each session to its worktree compared every session against every worktree record, resolving paths each time; with 3,867 sessions and 599 records that took about 1.4 to 2 seconds of daemon CPU per load and stalled every other request. The match now resolves each path once and looks sessions up directly (about 6 ms for the same data). The machine-wide session list also stops running `git` for each worktree session: it shows a worktree's identity and branch, and the open session still reads its ahead, behind and changed-file counts.
