---
"forgerie": patch
---

Block concurrent reopens and input while cleanup deletes ephemeral sessions. Enforce closing admission at the shared deletion boundary, drain new-session construction, and protect a fork source until its retired runtime closes. Preserve original session files when removing worktree snapshot references.
