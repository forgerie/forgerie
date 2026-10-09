# Project groups and related repositories

A group bundles normal projects for navigation. Each chat stays in its starting project. The same agent can work in another member's managed worktree without starting a second chat or agent.

## Set up a group

Open **Settings → Project groups**, or choose **Group projects…** in the session list's ⋯ menu. Press **New group**, type a name and check its projects. With many projects, type in **Find a project** to narrow the list. If a project is missing, enter its folder under **Add a project folder**; Forgerie adds it as a project and checks it in the group. Press **Create group** or **Save**. A project can belong to more than one group. To delete a group, open it and choose **Delete group** in its ⋯ menu, then confirm.

To show one group's sessions, choose the group in the session list's ⋯ menu. A strip with the group's name then stands above the list. Its × button, or **All projects** in the menu, shows every project again. The browser remembers the choice across reloads. With no groups, the session list shows nothing extra. The list's own **Group by state** and **Group by project** arrangement still applies inside the chosen group. Grouping does not move files, rewrite session history or change a session's default directory. Deleting a group does not delete its projects or worktrees. An unavailable member stays visible while editing the group.

Group writes detect stale revisions. If another window changes a group, Save refuses and keeps your draft. Choose **Discard changes** to load the current group, then make the change again. A draft also stays when you go back to the list and open the group again. Group data lives in `project-groups.json` under Forgerie's data directory; sessiond is its sole writer.

## Work in another repository

Ask the agent to work in a member project, for example "also change korri-plugins". The agent prepares a worktree there with its `project_worktree` tool. This creates a separate branch and checkout, not another conversation. A repeated prepare reuses an active checkout owned by this exact chat. It never takes another chat's checkout.

When the run that made the worktree ends, the worktree appears in the chat's header ⋯ menu, under the chat's own branch. A small number on the ⋯ button counts these worktrees; the input bar does not change. Each worktree has its own section with **Changes and files**, **Pull requests**, **Land on main** and **Discard worktree** for that repository only. The ordinary chat controls still target its starting project. Review notes on a related worktree wait in its section; **Add N review notes to the message** puts them in the chat's draft with the full target path. A landed or discarded worktree leaves the menu once its cleanup is done.

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

Setup failures retain their path and log. The worktree's section says **Setup failed** and offers **Retry setup** and **Ask the agent about the failure**, which puts the log in the draft. Failed cleanup remains retryable. **Settings → Project groups → Related worktrees** provides recovery controls even if a chat was archived or deleted. Source archive, group deletion and project regrouping do not automatically destroy secondary work.

PR links and watches remain scoped to the selected checkout. Equal PR numbers in two repositories are distinct. Notifications and merge notes return to the original chat. A completed/removed checkout no longer accepts new PR watches; stop or unlink old links before reusing that PR from another checkout.

## Limits

There is no atomic Land-all operation, automatic dependency wiring, automatic remote-machine placement or automatic delegation. Cross-repo integration tests must use the intended local revisions explicitly. Existing shell and filesystem tools retain their normal host access; managed records cannot prevent an external process from editing files.

Project lists refresh when the management view opens, after a local change, on window focus or on **Read groups again** in the page's ⋯ menu. Related work refreshes on open and after a run or lifecycle action. A failed catalog read never deletes stored group data.
