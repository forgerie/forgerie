---
"forgerie": patch
---

Backlog settings migration no longer stops when a registered project's folder has been deleted. Such a project has no repository file to import, so the migration skips it.
