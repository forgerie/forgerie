---
"forgerie": minor
---

Bundle `pi-subagents` 0.76.1 and load it into every hosted session, so delegated agents work without a Pi package setting. Agents marked `advertise: true` appear in the parent's prompt with their descriptions, and each agent file can pin its own model. A different `pi-subagents` copy in the Pi profile is ignored in hosted sessions with a warning that names the bundled path. The Agents panel now shows a finished agent's `finalOutput`.
