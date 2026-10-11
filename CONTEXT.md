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
