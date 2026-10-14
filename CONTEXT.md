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

## Processes

**Managed process**:
A command that an agent starts in the background from a session. The session owns it. It keeps running when Forgerie restarts, and it ends only when someone stops it, when it exits, or at session close. Its owner never changes: a handoff or a fork leaves it with the session that started it.
_Avoid_: Background job, background task, service

**Workspace service**:
A long-running service declared in a worktree's services file. The worktree owns it, so it outlives any one session. It is not a managed process.
_Avoid_: Dev server, process

**Session close**:
The moment a session is archived or deleted, or its worktree is removed. It ends every managed process the session owns.

**Child process**:
A managed process that a child agent starts. It ends when the child finishes, unless the child hands it to its parent in its report.

**Missed event**:
An exit or a watch match of a managed process that happened while Forgerie was down. The session receives it on resume with the attention level the watch asked for.

**Lost process**:
A managed process whose supervisor disappeared, for example after a reboot. Forgerie reports it as ended and never runs it again by itself.

**Attached process**:
A managed process on a host where Forgerie cannot detach it. It ends when Forgerie restarts, and Forgerie labels it that way wherever it appears.
_Avoid_: Fallback process

## Triggers

**Trigger**:
A saved schedule that starts one saved prose workflow, with one set of inputs, in one or more projects. A trigger is one record: one name, one schedule, one Pause.
_Avoid_: Cron job, scheduled task

**Target projects**:
The projects a trigger runs in. Every target project gets the same workflow name and the same inputs. The user picks single projects, a fixed list, or **All projects**, a live selection that includes projects added later. **All projects** has no exceptions. Under **All projects**, a project that cannot run, such as one whose folder is gone, is skipped and shown as unavailable; it does not set attention.

**Fire**:
One occurrence of a trigger, by schedule or by Run now. A scheduled fire starts one new session for each target project, all at once. Run now can start in all target projects or in one. A fire records one outcome for each project, so it can partly fail.

**Project workflow**:
A workflow file in a project's `.pi/prompts` folder. Only that project has it.

**Global workflow**:
A workflow file in Forgerie's agent `prompts` folder. Every project has it. A project workflow with the same name replaces it in that project.
