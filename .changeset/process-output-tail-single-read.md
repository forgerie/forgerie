---
"forgerie": patch
---

Opening a process's output in the panel reads its tail in one pass. The daemon checks the process state once instead of once per 1,000 lines, and reads 10,000 lines per batch. On a retained 100,000-line log in a controlled benchmark, the median fell from 92–316 ms to 17–18 ms. Line numbers, the cursor and dropped-line counts are unchanged, and the read still does not consume watch output.
