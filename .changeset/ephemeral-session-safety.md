---
"forgerie": patch
---

Prevent ordinary session directories from being treated as ephemeral. Reject overlapping storage configuration without changing existing files. Block concurrent reopens and input while deleting an ephemeral session, drain admitted runtime opens, and reuse one alias inventory for bulk deletion.
