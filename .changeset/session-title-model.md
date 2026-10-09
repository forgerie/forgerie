---
"forgerie": minor
---

Add the `sessionTitleModel` config key. It names the `provider/model-id` that writes session titles, so a small fast model can do this instead of each session's own model. When the key is absent, or the model has no credentials, the session's own model writes the title as before.
