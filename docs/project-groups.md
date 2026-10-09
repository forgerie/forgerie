# Project groups and related repositories

A group bundles normal projects for navigation. Each chat stays in its starting project. The same agent can work in another member's managed worktree without starting a second chat or agent.

## Set up a group

Open **Settings → Project groups**. **Manage** next to the group filter in the session list opens the same page. Register an existing project folder if it is not listed. Create a group, enter a name and select its member projects. A project can belong to more than one group.

Choose the group in the session list to filter sessions. The browser remembers the choice across reloads. **All projects** restores the complete list. The list's own **Group by state** and **Group by project** arrangement still applies inside the chosen group. Grouping does not move files, rewrite session history or change a session's default directory. Deleting a group does not delete its projects or worktrees. An unavailable member stays visible while editing the group.

Group writes detect stale revisions. If another window changes a group, refresh before saving again. An unsaved editor draft stays on screen after a refused save. Group data lives in `project-groups.json` under Forgerie's data directory; sessiond is its sole writer.

## Work in another repository

Open **Related repos** above the chat composer. Prepare a worktree for a member project. This creates a separate branch and checkout, not another conversation. A repeated prepare reuses an active checkout owned by this exact chat. It never takes another chat's checkout.

Each related worktree exposes Changes and files, pull requests, Land and Discard. These controls target that repository only. The ordinary chat controls still target its starting project. Review notes can be added to the same chat's draft with the full target path.

The agent has these native tools:

| Tool | Behavior |
|---|---|
| `project_context` | Lists the starting project's groups, members and owned secondary worktrees. With `projectId`, reads bounded target instructions and returns the correct checkout path. |
| `project_worktree` | Prepares or inspects an owned worktree, or performs explicit Land/Discard. Prepare supports a stable `requestId`; Discard requires the current preview token. |
| `github_read`, `github_write`, `github_watch` | Accept an optional `worktreeId` for a secondary repo. Without it, they keep using the starting repo. |

Use the returned absolute paths with the normal coding tools. The agent must read the target instructions before edits. Forgerie does not merge target settings or load its extensions into the starting chat. No third-party workspace or worktree package is installed by this feature.

Only registered projects on this machine are offered. The tool's new-work target must share a group with the starting project, or already have a retained attachment to that chat. Group membership organizes discovery; it is not an OS sandbox or permission to merge, discard or deploy without user authorization.

## Finish and recover

Land rebases and fast-forwards one repository. It does not push or merge the entire group. Discard previews the commits and dirty files that will be lost, then requires confirmation bound to that preview. Removing a secondary worktree leaves the starting chat writable.

Finish secondary work and its cleanup before landing or discarding the chat's starting worktree. Lifecycle operations refuse an owning chat's active run, managed processes or delegated agents. A tool called by the owning agent can land its own target during its turn, but background processes and agents must first stop.

Setup failures retain their path and log. Retry setup from Related repos. Failed cleanup remains retryable. **Settings → Project groups → Related worktrees** provides recovery controls even if a chat was archived or deleted. Source archive, group deletion and project regrouping do not automatically destroy secondary work.

PR links and watches remain scoped to the selected checkout. Equal PR numbers in two repositories are distinct. Notifications and merge notes return to the original chat. A completed/removed checkout no longer accepts new PR watches; stop or unlink old links before reusing that PR from another checkout.

## Limits

There is no atomic Land-all operation, automatic dependency wiring, automatic remote-machine placement or automatic delegation. Cross-repo integration tests must use the intended local revisions explicitly. Existing shell and filesystem tools retain their normal host access; managed records cannot prevent an external process from editing files.

Project lists refresh when the management view opens, after a local change, on window focus or on Refresh. Related work refreshes on open and after a run or lifecycle action. A failed catalog read never deletes stored group data.
