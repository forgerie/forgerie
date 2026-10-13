# Forgerie

Forgerie is a browser control surface for persistent Pi coding agent sessions on the user's own server.

## Search

**Session search**:
A text search over the user's messages and the assistant's replies in active and archived sessions on one machine. The user's messages count as what the user typed or pasted. Skill and file blocks, thinking, tool calls, tool results, and child sessions are not searched.
_Avoid_: History search (that is the search inside one session's tree)

**Search hit**:
A session that matches a query, shown with its newest matched passage and the count of its other matches.
_Avoid_: Result, match

**Matched passage**:
The excerpt of a session's text that made it a search hit. Opening a search hit opens the session at that passage.
_Avoid_: Snippet, highlight

**Off-branch hit**:
A search hit whose matched passage lies on a branch other than the session's current branch. Opening it shows the passage in the session's history tree and leaves the current branch as it is.

## Autonomy

**Autonomy policy**:
The rule that says which situations reach the user and which the agents settle themselves. One global default; a project or a workflow can tighten or loosen it.
_Avoid_: Permission mode, trust level

**Escalation**:
A situation that the autonomy policy sends to the user: an irreversible action, an action outside the project in the user's name, going against something the user said or approved, or a question the parent cannot answer anywhere. Everything else is a decision the agents make.
_Avoid_: Question (a child's question goes to its parent first and is not an escalation by itself)

**Gated action**:
A tool call that is irreversible or acts outside the project in the user's name. Forgerie blocks it in code until the user approves; the agent keeps working on what does not depend on it.
_Avoid_: Dangerous command

**Decision**:
A choice an agent made without the user, such as a parent's answer to a child's question or a guess in place of an escalation. Each decision records the question, the choice, and the reason.

**Decision log**:
The non-blocking list of decisions for one session or workflow run. The user reads it when they like and can overturn any decision.
_Avoid_: Audit log, history

**Auto-land**:
A setting, global or per workflow, under which a workflow's land stop passes without the user and the run lands its branches itself.
