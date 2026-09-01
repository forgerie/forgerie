# skills

Forgerie session skills. Sessiond loads these only into sessions that it
hosts. They do not enter the shared Pi profile, so TUI sessions do not see
them.

## handoff

Create the continuation session immediately via `handoff_session`. The source
turn ends at once while the destination prepares its own compact context and
then continues the work.

## relay

Execute a long or complex plan as a chain of independent sessions, each running
one well-sized leg and handing off to the next via `spawn_session`.
