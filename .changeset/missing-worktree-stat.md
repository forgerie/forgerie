---
"forgerie": patch
---

Report a missing worktree folder with one file check instead of a `git` child process. A worktree record whose folder is gone used to run `git worktree list` on every session list before failing; with 59 such records on one machine that was about six `git` child processes per second from sessiond's main thread. The status now says "The worktree folder is missing." and recovers at once when the folder is back.
