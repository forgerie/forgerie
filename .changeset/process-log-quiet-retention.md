---
"forgerie": patch
---

Make process output panels faster. Reading a retained log no longer rewrites its position file and starts `fallocate` on every refresh when retention has not advanced. A new tail read decodes only the newest lines, with the same line numbers, cursor and dropped-line count as a full browse.
