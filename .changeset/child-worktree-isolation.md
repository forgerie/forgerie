---
"forgerie": patch
---

Add opt-in worktree isolation for Durable child agents. Children can edit independently from the parent's committed HEAD, report their branch and changed files, and keep their checkout across restarts. Add API actions to land or discard a finished child's worktree with ownership checks and a required discard confirmation token.
