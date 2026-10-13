# A child's question goes to its parent; only escalations reach the user

Status: accepted, 2026-10-12

A Durable child's `ask_human` question goes to its parent agent first, not to the user. The parent answers from the task, the contract, the code, and the chat, and records the answer as a decision. It passes a question to the user only when it is an escalation: an irreversible action, an action outside the project in the user's name, going against something the user said or approved, or a question the parent cannot answer anywhere. Taste calls and scope growth are not escalations; the agents decide them and the decision log shows them.

When an escalation is not an irreversible or external action, the agent proceeds on its best guess, marks the guess, and the user can overturn it later. The user is never a bottleneck by default. A guess shows in the decision log, flagged, with a count on the session. It does not pin in the dock and does not mark the session "Needs your response", because nothing waits on it.

The parent's own `ask_user` tool stays, for escalations only. For anything else the parent decides and records a decision.

This applies to Durable sessions and Durable child agents. Legacy pi-subagents runs keep their behaviour. The user hears about escalations in the app only: the session's "Needs your response" state and the dock. There are no push notifications.

## Considered options

- The user answers first (the behaviour before this decision): every child question waits on the user.
- The parent answers first, with a timeout that forwards the question to the user: rejected for now, because a slow parent would send questions to the user for the wrong reason.

## Consequences

A wrong answer from the parent can travel into later work before the user sees it. The decision log and its overturn action limit this cost; they do not remove it. Each child question also costs a parent turn.
