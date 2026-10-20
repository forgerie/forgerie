---
"forgerie": patch
---

Resume a turn that a sessiond restart interrupts, without a new message. Before, the stopping daemon recorded the killed command's exit 143 result and kept the turn running. Its later tool calls failed with `Durable storage ownership lost or already held … (flock exit null, signal SIGTERM)` or `No SDK adapter bound for conversation 1`. When the model then ended the turn, the session waited until the user wrote. Now the stopping daemon holds the turn, and the next daemon resumes it. The killed command reports that it was interrupted and may have partially run, and it is not run again. The stopping daemon also keeps its storage lock until it exits. Child agent turns are not held yet.
