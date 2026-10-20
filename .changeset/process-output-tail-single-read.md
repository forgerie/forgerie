---
"forgerie": patch
---

Opening a process's output in the panel reads its tail in one pass. The daemon checks the process state once instead of once per 1,000 lines, and decodes only the newest lines it returns. Line numbers, the cursor and dropped-line counts are unchanged, and the read still does not consume watch output.
