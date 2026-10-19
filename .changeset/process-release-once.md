---
"forgerie": patch
---

Make sessiond stop slowing down as managed processes finish. Each finished process now releases its systemd unit once, not on every list. Before, sessiond started a `systemctl` child for every finished process in every session on each 30-second pass and each process list, so its main thread grew busier with every process ever run. On a daemon with 283 finished processes, this kept it about 99% busy and made the backlog, session lists and project views take 10 to 80 seconds.
