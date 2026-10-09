# Durable child agents

Status: opt-in. Set `"durableChildren": true` in the Forgerie config, or `PI_WEB_DURABLE_CHILDREN=1`, and restart the session daemon.

A session can run background child agents inside its own Durable storage. The agent starts one with the `child_agent` tool. You do not switch sessions to follow it.

## What you can do

| Action | Where | Effect |
| --- | --- | --- |
| See every child | The robot control in the session header | Lists the session's children. Children with a question for you come first, then working ones. The badge counts open questions; a dot means a child is working. |
| Read a child | Open it from the list | Shows its task, its tool calls with folded output, and its replies as they stream. |
| Steer a child | The reply box in the open child | While it works, your message joins its run at its next tool call. When it is idle, your message is a new task. |
| Stop a child | Stop, beside the reply box | Ends the child's current work. The parent keeps running. |
| Answer a child | The question card in the parent thread, or in the open child | The answer goes to the child. The parent model gets no turn. |

The parent model sees each steer and stop as a note, so it does not undo what you told a child. Each child's final answer reaches the parent as a new message, and the parent continues from it.

Esc in the parent does not stop its children.

## Agent files

`child_agent` may name an agent file with `agent`. Forgerie reads the same files as pi-subagents, in this order: the project's `.pi/agents/`, the profile's `agents/`, then the bundled pi-subagents agents. The first file with the name wins.

Forgerie reads these frontmatter keys: `name`, `description`, `model` (with an optional `:thinking` suffix), `thinking`, `tools`, `inheritProjectContext`, and `disabled`. A file that lists `fallbackModels` is skipped. Other keys are ignored.

A child gets Durable's `read`, `write`, `edit`, and `bash` tools, plus `ask_human`. `tools` narrows them: `grep`, `find`, and `ls` map to `bash`. A child cannot start children of its own.

## Restarts

Children live in the parent's Durable storage, and they run only while the daemon has the parent session open. The daemon records sessions with live child work in `$PI_WEB_DATA_DIR/durable-children-live.json` and reopens them at startup, so a restart pauses a child and does not lose it. A tool call that was interrupted reruns only when the tool is replay-safe; otherwise the child is told that the call was interrupted.

## Limits

- Children share the parent's working folder. There is no per-child worktree yet.
- A child is not a Forgerie session: it has no catalog entry, title, archive, or pin.
- Each child report gives the parent model a turn, which costs parent tokens.
- pi-subagents still loads beside this feature. Its `subagent` tool is unchanged.

## Code

- Server: `src/server/sessions/durableChildAgents.ts`, `durableChildHost.ts`, `durableChildProfiles.ts`, `durableChildRoutes.ts`.
- Browser: `ui/src/childAgents/`.
- Spike and findings: `prototypes/durable-child-spike/README.md`.
