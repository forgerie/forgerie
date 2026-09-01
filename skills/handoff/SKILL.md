---
name: handoff
description: "Immediately detach the current conversation into a continuation session. Use when the user says \"handoff\", \"hand off\", \"hand this off\", \"continue in a new/fresh session\", or wants to compact context and continue elsewhere without waiting in the current thread."
argument-hint: "What will the next session focus on?"
---

# Handoff

Call `handoff_session` immediately. Do not summarize the conversation, inspect
files, write a handoff document, or do any other preparation in this session.
The destination session owns all context preparation.

Pass the user's arguments as `focus`. Omit `focus` when they only asked to
continue the current work. Inherit cwd and model unless the user explicitly
requested another workspace or referenced a model as `#provider/model-id`.

Call the tool exactly once, alone and last. It creates the destination session,
records the handoff lifecycle, and ends this run. Do not add a closing message
after the tool call.

The destination session will:

1. Read a private snapshot of the source session's active branch.
2. Write `.pi-web/handoffs/<handoff-id>.md` with the compact context.
3. Mark preparation ready or failed through Forgerie's lifecycle records.
4. Continue the work after preparation succeeds.

If `handoff_session` is unavailable, state that detached handoff is disabled in
this Forgerie session. Do not fall back to doing the slow summary in this
thread unless the user explicitly asks for a manual handoff document.
