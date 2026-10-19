---
"forgerie": patch
---

Keep child-run history in memory instead of re-reading it on every request. The browser polls the child-run list every few seconds for each open session, and each poll read, parsed and validated the whole `child-runs.json` file: 1.2 MB and 1,249 records after a few weeks, 24% of sessiond's main thread in a profile. Sessiond now reads the file once at startup, serves reads from memory, and writes the file only when a record changes. Sessiond is the file's only writer; a change made to the file by another program is not seen until the next restart.
