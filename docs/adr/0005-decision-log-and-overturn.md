# The decision log records what agents settled, and overturning re-opens it

Status: accepted, 2026-10-12

Each session and workflow run keeps a decision log. It records:

- the parent's answers to child questions;
- guesses made in place of an escalation;
- stops passed without the user;
- gated actions the user approved or refused;
- issues the agents filed.

The log does not record other choices the agent judges notable on its own, because that judgement is noisy.

Overturning a decision sends the user's correction to the agent that made it, which wakes and redoes the affected work. If that agent has finished, the correction goes to its parent.

A child waits for its parent's answer, so its work is built on the parent's answer and not on its own guess. Only the parent files issues; a child suggests issues in its report.

## Consequences

The log is a new record and a new surface in the browser. An overturn can throw away work and costs tokens to redo it.
