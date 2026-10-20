---
"forgerie": patch
---

Cache project-view Git repository checks and worktree listings for 10 seconds, sharing concurrent reads. Managed worktree changes invalidate discovery immediately; changes made outside Forgerie can appear up to 10 seconds late. Only catalog display uses the cache. Spawn, session, trigger, and project-tool workspace authorization and lifecycle ownership checks remain fresh.
