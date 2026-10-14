# One trigger fires in many projects

Status: accepted, 2026-10-14

A trigger can name several target projects. Each fire starts one new session for each target project. All target projects get the same workflow name and the same inputs. The trigger stays one record, so one edit changes the schedule for every project and one Pause stops them all. The user picks single projects or **All projects**, which includes projects added later and has no exceptions. Under **All projects**, a project that cannot run is skipped and shown as unavailable, without attention. A trigger does not check for new commits; the workflow finishes early when it has nothing to do. The workflow picker offers only workflows that every target project can run, so global workflows always qualify. A fire starts all sessions at once. If some projects fail, the others still run, and the trigger asks for attention. Run now starts in all target projects or in one that the user picks. Only the Triggers page can set more than one target project. The `workflow_schedule` agent tool keeps its current rule: an agent can schedule work only in its own project.

## Considered options

- One separate trigger for each selected project: a small change, but the copies are not linked. A new time means one edit for each project.
- One session that works across all the projects through a project group: one failure stops all the work, and one context must hold every repository.
- Offer every workflow and skip projects that lack it: the trigger can look healthy and do nothing in some projects every night.
- Start at most N sessions at a time: gentler on the model quota, but a run that waits at a land stop makes "done" unclear.
- Check every project first and start none if one fails: one deleted folder stops all projects.
- Live project groups as targets: editing a group would change a trigger without the user seeing it. This can come later.
- Let agents set target projects in the same group: an agent in one repository could schedule nightly token use in other repositories.

## Consequences

A fire can partly fail: some projects start a session and others do not. The fire record and the trigger history must hold one outcome for each target project. The stored action changes from one `cwd` to a list, so existing triggers need a migration. With **All projects**, every new project starts the workflow at the next fire, and all sessions draw on the model quota at the same time.
