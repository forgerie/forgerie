---
"forgerie": patch
---

Start sessions in folders that are not git repositories. Session start read the folder's `origin` remote and failed with "not a git repository"; Forgerie now treats such a folder as having no GitHub or Azure remote.
