---
"forgerie": patch
---

Add session pinning. Pin a session from its inbox row commands (or the inline row action) and it stays at the top of its group in both the state and project views, on every browser. A pinned session cannot be archived — the archive button and menu entry disappear, and the server refuses direct, bulk, tree, and cleanup archives with "Unpin session before archiving" until you unpin it.
