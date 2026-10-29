---
"forgerie": patch
---

Use named model chains in main sessions, session titles and every model menu. Main sessions keep their active chain across restarts, continue failed turns on the next model, show switch notices and let Stop cancel a pending retry. New sessions, triggers, backlog suggestions and defaults carry the selected chain into the session. All sessions share provider cooldowns. Coalesced inputs share one recovery owner. Background inputs wait behind recovery, including before an all-cooling chain's first request. Trigger and spawn chains skip missing catalog entries. Main-session compaction uses the child diagnostic privacy guard.
