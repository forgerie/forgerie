# skills

Forgerie session skills. Sessiond loads these only into sessions that it
hosts. They do not enter the shared Pi profile, so TUI sessions do not see
them.

## ask-user

Gate high-stakes or ambiguous decisions behind Forgerie's web-native
`ask_user` form: gather evidence, ask one structured decision, commit to the
answer. Adapted from the MIT-licensed `ask-user` skill in
[`pi-ask-user`](https://github.com/edlsh/pi-ask-user) to Forgerie's
`ask_user` schema. Forgerie does not load that package.

## handoff

Create the continuation session immediately via `handoff_session`. The source
turn ends at once while the destination prepares its own compact context and
then continues the work.

## relay

Execute a long or complex plan as a chain of independent sessions, each running
one well-sized leg and handing off to the next via `spawn_session`.
