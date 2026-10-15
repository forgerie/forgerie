---
"forgerie": patch
---

Let Settings save, replace and remove the Decision hints gateway key in the active profile with private atomic writes. Sessiond applies file changes on the next request without restarting. Environment keys retain precedence and remain read-only in Settings. Document that agents running as the same Unix user can read profile key files.
