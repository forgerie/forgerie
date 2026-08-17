---
"forgerie": patch
---

Give the /tree session navigator the Pi TUI's reading lenses. Five filters — User, No tools, Conversation, Labeled, All — narrow the history, and the dialog now opens on User, because a user message is the only entry whose text returns to the composer. Bookkeeping entries (labels, model and thinking changes, session info, custom entries) leave the conversation lenses, and an assistant turn that only called tools is hidden everywhere except when it is the active leaf. Hidden entries never orphan their descendants: survivors re-attach to their nearest retained ancestor and indentation is recomputed, so switching lenses never drifts the tree rightward. A counter shows the selected position within the current lens, an empty lens says so instead of claiming the session is empty, and the cursor stays anchored to the entry you picked, returning to it when the lens widens again.
