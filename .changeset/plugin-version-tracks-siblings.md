---
"forgerie": patch
---

Version a Forgerie plugin by the newest file beside its entry module, not by the entry module alone. Plugin assets are served without cache headers, so a plugin that splits itself across modules kept serving stale code after an edit: the entry module's URL never changed, and a reload silently reused the browser's cached copy of every module it imports.
