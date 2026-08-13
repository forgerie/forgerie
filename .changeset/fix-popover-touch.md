---
"forgerie": patch
---

Composer menus no longer dismiss when you press a row. The dismissal check
tested containment within a single DOM tree, but the rows live in the content's
own shadow root, so every press counted as outside the panel and closed it.
