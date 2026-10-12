---
"forgerie": patch
---

Durable child agents now read agent files from `~/.agents/`, as pi-subagents already does. An agent file there works in both runtimes and every Pi profile. It ranks below the project's `.pi/agents/` and above the profile's `agents/`.
