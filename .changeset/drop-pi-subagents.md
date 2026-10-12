---
"forgerie": minor
---

Stop bundling `pi-subagents`. Hosted sessions delegate only through Durable children (`child_agent`), which are now on by default; set `durableChildren: false` to turn them off. Forgerie ships its own `worker`, `scout`, `delegate`, `reviewer`, `researcher`, and `evidence-auditor` agents. Fork context, nested children, external CLI runners, workflow scripts, schedules, and missions from pi-subagents are no longer available. A Pi profile that installs `pi-subagents` itself still loads it.
