# Gate irreversible and external actions in a Durable tool hook

Status: accepted, 2026-10-12

Forgerie enforces gated actions in code, not in prompt wording. One Forgerie Durable extension adds a `beforeTool` hook on `ToolTask` (Pi Durable's hook point for every tool call). The hook recognises gated actions and blocks them until the user approves. A child conversation starts as a copy of its owner's agent, so the same extension reaches children.

When the hook blocks a call, Forgerie posts an approval card and the agent keeps working on what does not depend on the action. When the user approves, Forgerie runs the action and tells the agent the result. When the user refuses, the agent hears that too. An approval covers that one call only. An approval card is a real wait, so it pins in the dock and marks the session "Needs your response".

Gated by default:

- force-push, and pushing to the default branch;
- discarding uncommitted work: `git reset --hard`, `git clean`, `git checkout --` on dirty files, and removing a worktree that has changes;
- deleting remote branches, tags, or releases;
- merging or closing pull requests, and closing issues that agents did not file;
- publishing: `npm publish`, releases, and deploys to shared targets;
- messages and money in the user's name, such as eBay replies and offers, emails, and paid API jobs.

Not gated by default: restarting Forgerie's own units, and landing on the local main branch by rebase and fast-forward.

Prompt wording still covers what the hook cannot recognise, such as a shell script that hides a force-push. The autonomy policy decides which actions are gated, with one global default in Forgerie Settings and project or workflow overrides.

## Considered options

- Prompt wording only: nothing to build, but a model can ignore it.
- A Pi coding-agent `tool_call` extension: works for hosted Pi sessions, but Durable sessions and their children run their tools through Durable tasks, where the `ToolTask` hook is the single place every call passes.
- The hook waits inside the tool call until the user decides: simpler, but the agent stalls completely.

## Consequences

Someone has to keep the list of gated actions. An action that is missing from the list, or hidden inside a script, gets through the hook. When everything an agent has left depends on a gated action, the agent is idle until the user decides.
