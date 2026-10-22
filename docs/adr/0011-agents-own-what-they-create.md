# Agents own the Git work that Forgerie creates for them

Status: accepted, 2026-10-22

Agents asked the user dozens of times a day to clean up worktrees, clones, branches and tags that they had made minutes earlier. Between 2026-10-19 and 2026-10-21 the user approved 71 such daytime gates in under 30 minutes each and refused none.

Forgerie now offers the `scratch_git` tool to parents and to children that may run `bash`. The tool creates worktrees, clones, branches and new remote refs by running Git itself, and it records each one in a ledger on the parent conversation, with an identity that a delete-and-recreate cannot reproduce. The family then removes what the tool made without a gate, through the tool or, for branches, through a literal `git branch -D` in Bash. Everything that the tool did not make gates exactly as before. [Gated actions](../gated-actions.md#scratch_git-owned-worktrees) describes the actions and checks.

This amends [ADR 0003](0003-gate-actions-in-a-durable-hook.md). The gate stays a fail-closed classifier of tool calls. Ownership adds one fact it may read, and only Forgerie's own Git commands write that fact.

## Considered options

- **Infer ownership from Bash.** Parse each command for `git worktree add`, `git clone` and branch creation, observe the folders before and after the call, and resolve literal shell variables so that `$W` and `$SHA` targets count. A branch built this way failed review twice. Bash changes variables in ways a static reader does not see, such as `${W:=…}` and `printf -- "%n"` ([#91](https://github.com/forgerie/forgerie/issues/91)). An observation that a path is new does not prove that this call made it, because another writer can create it during the call ([#92](https://github.com/forgerie/forgerie/issues/92)). Observing every call also added Git and network reads to ordinary tool calls ([#93](https://github.com/forgerie/forgerie/issues/93)).
- **Check at the moment Git runs.** A `git` wrapper on the agent's `PATH` would decide each discard or push against the real repository and real values. It handles variables, but it needs a way to pause a running shell for approval, and an agent can still call the real binary by its path.
- **Let Forgerie create the work (chosen).** The tool knows the outcome of the Git commands it ran, so no inference is needed. `mkdir` claims each folder before Git writes to it, and `git worktree add -b` refuses an existing branch, so a concurrent writer cannot hand its work to the agent.

## Consequences

An agent can discard uncommitted work in a tree the tool made for it, and delete the tool's branches and pushed refs, without asking. Outside `/tmp`, the worktree backup is the only copy.

Agents must use the tool to get the exemption. Worktrees made with plain `git worktree add`, and commands that name a target through a shell variable, still gate. Prompt guidance and the tool description steer agents to the tool; agents that ignore them see the old gates.

A branch whose reflog is missing or disabled cannot prove its identity, so it is kept and its deletion gates. A tree on a filesystem without creation times cannot be created through the tool. The gate does not retire a ledger record when an identity check fails; the record grants nothing in that state, and the tool's `remove` retires it.
