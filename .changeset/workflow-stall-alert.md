---
"forgerie": minor
---

A workflow run no longer sits idle without notice after a child fails. If nothing runs for 2 minutes, Forgerie wakes the agent once with the child's error. If nothing runs 2 minutes after that, the run counts as **Needs your response** and its strip says **Stalled: \<child\> failed, waiting for you**. Your next message to the agent, a new child, or the end of the run clears it.
