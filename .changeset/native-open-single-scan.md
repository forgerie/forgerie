---
"forgerie": patch
---

Open native sessions faster. A cold native open now decodes its committed history once instead of twice, and an open of a session whose live publisher is already attached reuses that publisher's committed history instead of reading every entry again. Each open still takes a fresh read lease, a new consistent cut and current host status.
