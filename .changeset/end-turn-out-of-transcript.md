---
"forgerie": patch
---

Keep `end_turn` out of the transcript and stop silent turn endings. The browser no longer shows the declaration as a tool call, in history or live. `end_turn` now refuses a call whose message has no visible text, so an agent cannot end a run with its answer only in thinking and still mark the session Needs your response.
