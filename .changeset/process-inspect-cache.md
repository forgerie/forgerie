---
"forgerie": patch
---

Make running managed processes cheap for sessiond to watch. The process watcher checks every session's processes each second, and each check of a running process started a `systemctl` child from sessiond's main thread, twice per pass. Sessiond now reuses a "running" answer from systemd for 15 seconds. A process that exits normally still shows as ended within a second, and a stopped process is checked again at once. Only a process whose systemd unit disappears without an exit record shows as lost up to 15 seconds late. With 6 running processes this was about 12 child processes per second and 46% of sessiond's main thread.
