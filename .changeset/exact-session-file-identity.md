---
"forgerie": patch
---

Keep replaced sessions and remembered session names correct on filesystems with large 64-bit inode values, including bcachefs. Preserve exact file identity in session caches and migrate safe legacy name indexes.
