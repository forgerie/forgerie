---
"forgerie": patch
---

Adding a project folder that does not exist no longer fails with a raw `ENOENT` error. The project group page now asks "No folder at … Create it and add it as a project?" and creates the folder only when you press Create folder. Editing the path or pressing Cancel drops the offer.
