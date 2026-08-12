---
"forgerie": patch
---

Fix selecting a model for a new session. The web server did not forward the
pre-session model catalog to the session daemon, so the picker had nothing to
show. The catalog is also now read from the destination machine rather than
whichever machine the app had selected.
