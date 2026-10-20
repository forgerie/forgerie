---
"forgerie": patch
---

Make workflow landing recover from repairs. Land now waits for a working repair child of the run to report before it lands: 90 s after a **Land all** click, 10 min when Forgerie lands by itself. When the time runs out, nothing lands and the message names the child that still works. A blocked land now names the files that block it, for example the uncommitted files in the main checkout for `main-dirty`. The repair advice now tells the agent that Land rebases each branch alone, in the order the children started, and keeps only non-merge commits.
