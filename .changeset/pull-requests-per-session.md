---
"forgerie": patch
---

Let one session link several pull requests, each with its own watch. Opening or linking another pull request no longer replaces the first one or silently ends its watch. The session pull request routes move to `/sessions/:id/pull-requests` and `/sessions/:id/pull-requests/:number`, and a link can be removed. The state file moves to version 2; an older daemon refuses to start with it.
