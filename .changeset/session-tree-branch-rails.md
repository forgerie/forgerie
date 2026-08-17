---
"forgerie": patch
---

Draw branch structure in the /tree navigator with hairline rails instead of bare indentation. A row now shows one lane per fork it sits under: the lane it belongs to draws an elbow, and ancestor lanes draw a continuous hairline only while that fork still has rows below, so a closed branch leaves no trail. Ordinary single-child history keeps no lane at all and never marches rightward. A folded entry also keeps a caret now, so collapsed rows have a visible cause.
