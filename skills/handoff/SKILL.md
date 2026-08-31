---
name: handoff
description: "Compact the current conversation into a handoff document, then immediately start the continuation session with spawn_session. Use when the user says \"handoff\", \"hand off\", \"hand this off\", \"continue in a new/fresh session\", or wants to compact context and continue the work in another session."
argument-hint: "What will the next session focus on?"
---

# Handoff

Compact the current conversation into a handoff document, then start the
continuation session yourself with `spawn_session`. The handoff is done when
the new session exists — not when a document exists.

## 1. Write the handoff document

Save it to `.pi-web/handoffs/<UTC yyyy-mm-dd-hhmm>-<slug>.md` in the current
project. Create the directory if it does not exist. The slug names the
continuation's focus.

The document gives a fresh agent everything it needs to continue:

- The goal, and where the work stands: done, in flight, not started.
- Decisions made and why — cover the ones a fresh agent would plausibly
  re-litigate.
- Next steps, most important first.
- Skills the next session should load, if any.
- Pointers to existing artifacts (plans, PRDs, issues, commits, diffs, docs)
  by path or URL. Do not duplicate content that already lives in them.

If the user passed arguments, treat them as the next session's focus:
emphasize the context that serves it, and cut what does not.

## 2. Spawn the continuation session

Make all work durable first — the next session can only see what is on disk.
Uncommitted intent, unsent conclusions, and anything else living only in this
conversation must be in the document or an artifact it points to.

Then call `spawn_session` exactly once:

```text
<One natural line stating what this session continues — the UI derives the
session name from it.>

Read <absolute path to the handoff document> and continue the work it
describes.
```

- **cwd**: omit to inherit this session's workspace. Pass another workspace
  only when the user asked for one.
- **model**: omit to inherit. If the user referenced a model as
  `#provider/model-id`, forward it.

`spawn_session` is fire-and-forget: you will not see the new session's output
and cannot steer it. Anything missing from the document is lost.

## 3. Close out

Tell the user, in a line or two, that the session was spawned and where the
document lives. Then stop — the handed-off work belongs to the next session
now, not this one.

If `spawn_session` is unavailable (it can be disabled in settings), stop
after writing the document, give its path, and tell the user to start the
next session manually with a prompt pointing at it.
