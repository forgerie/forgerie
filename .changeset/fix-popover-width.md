---
"forgerie": patch
---

Fix composer popovers opening as a sliver and creeping wider. The panel was
measured and then set to its own measurement, so each pass re-measured a box
that the previous pass had already constrained. Placement now returns a ceiling
and the panel takes its width from its content.
