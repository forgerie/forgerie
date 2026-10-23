---
"forgerie": patch
---

A session now opens after a power cut emptied one of its finished process logs. Before, sessiond refused to recover the whole session with "Managed process log was externally truncated" or "Invalid managed process log acknowledgement". Forgerie now drops the unreadable output of a process that ended or was lost and keeps its line numbers. A running process with a truncated log still reports the error.
