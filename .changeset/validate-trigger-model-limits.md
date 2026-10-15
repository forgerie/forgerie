---
"forgerie": patch
---

Validate scheduled model IDs at the file boundary, keeping the 128-character model limit separate from thinking suffixes. An invalid model now affects only its workflow file instead of disabling the trigger service.
