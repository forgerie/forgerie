---
"forgerie": patch
---

Gated actions no longer ask about safe commands that start with `cd <path> &&`, such as a push to a feature branch. An agent can discard work in a project `.worktree/` folder without asking: Forgerie backs up the uncommitted work to `worktree-backups` first.
