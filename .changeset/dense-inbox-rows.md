---
"forgerie": patch
---

Give the session inbox a density choice, dense by default. A dense row takes one
line: the title, its project, its time, and any live agent or process counts
share a baseline, and pinned rows show their pin beside the time rather than
before the title, so every title starts on the same rail. Nothing is dropped — a
session waiting on an answer, reporting an error, or naming what it is waiting
for still takes a second line for that message, which makes the rows worth
reading the tall ones. Choose Comfortable under Settings › Appearance to give
every row two lines again.

This also fixes a defect in both densities: the row's archive control was laid
out, so it set a floor of 28px on a line holding 14px of text. A finger removes
that control, so the same list measured 62px per row under a mouse and 52px under
touch, and changed height when the input changed. The control now floats and
costs no height at all.
