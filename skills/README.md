# skills

Forgerie session skills. Sessiond loads these only into sessions that it
hosts. They do not enter the shared Pi profile, so TUI sessions do not see
them.

## handoff

Compact the current conversation into a handoff document, then immediately
spawn the continuation session via `spawn_session`.

## relay

Execute a long or complex plan as a chain of independent sessions, each running
one well-sized leg and handing off to the next via `spawn_session`.
