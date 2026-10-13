---
"forgerie": patch
---

Refuse missing child tools unless explicitly allowed. Default writers to isolated worktrees and prevent concurrent shared writer spawns. Retry transient child provider failures durably with capped backoff and report the real error. Distinguish duplicate and stopped completion reports from delivery failures. Avoid unrequested workflow approval stops.
