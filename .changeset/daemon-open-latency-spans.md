---
"forgerie": patch
---

The session daemon no longer keeps an empty socket set for every session a browser has ever watched; it is released when the last socket closes. For temporary measurement profiles, `PI_WEB_STACK_LATENCY_FILE` records bounded session-open phase spans and adds a numeric `Server-Timing` header. It is unset by default, so deployed services record nothing.
