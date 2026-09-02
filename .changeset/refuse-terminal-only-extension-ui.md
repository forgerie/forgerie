---
"forgerie": patch
---

Stop extension questions from being answered "cancelled" by nobody. A hosted session has no terminal, so `ui.custom` and `ui.editor` now fail with an error naming the browser-backed dialogs, instead of resolving unanswered and letting extensions report a cancel the user never performed.
