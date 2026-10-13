---
"forgerie": patch
---

Refuse missing child tools unless explicitly allowed. Default writers to isolated worktrees and prevent concurrent shared writer spawns. Retry transient child provider failures durably with one owner per failed run, capped backoff, and the real error in the final report. Distinguish duplicate and stopped completion reports from delivery failures. Avoid unrequested workflow approval stops.
