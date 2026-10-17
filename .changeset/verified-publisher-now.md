---
"forgerie": patch
---

Publish recorded, verified isolated builds immediately with `forgerie deploy`, without waiting for active Durable sessions. Retain explicit idle mode, revision and build-content checks, paired service restart, previous builds, and rollback on publication or readiness failure. Require each service unit to be active so a healthy web process cannot hide a failed session daemon.
