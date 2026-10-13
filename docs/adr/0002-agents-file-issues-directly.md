# Agents file GitHub issues directly, with a label

Status: accepted, 2026-10-12

An agent creates a GitHub issue itself after it searches open and closed issues for the same work. Every issue it creates carries an `agent-filed` label, so the user can find, filter, and clean up what agents filed. This replaces the rule that every new issue goes through `propose_issue` and the user's tap. Only the parent agent files issues; a child suggests issues in its report, so one agent does the duplicate search. The `propose_issue` tool and its card are removed, so there is one way to file an issue.

## Considered options

- One proposal card per issue (the behaviour before this decision).
- One batch proposal card per session or run: fewer taps, but the user stays in the loop.
- Direct filing with no label: a cleaner backlog view, but no easy way to review what agents filed.

## Consequences

The backlog will get some duplicate or weak issues. The label and the decision log are how the user finds them.
