# Schedules live in workflow files

Status: accepted, 2026-10-15

A global workflow file in `<agentDir>/prompts/<name>.md` can declare one `schedule` in its YAML front matter. That file is the trigger, with ID `<name>`. The same file holds the schedule, targets, coordinator model, input overrides, workflow route and prose. Project workflow copies can override the workflow at launch, but their schedule blocks are ignored and diagnosed.

This replaces the separate, user-authored trigger settings record described in [ADR 0006](0006-one-trigger-fires-in-many-projects.md). It also replaces the assumption that the schedule can select any project-only workflow. ADR 0006's multi-project fan-out, All projects selection, project overrides, per-project outcomes, and agent scope rules remain in force. The durable trigger store remains the owner of run history, attention, fire admission and recovery receipts. Its schedule fields are a projection of the last valid file, not a second editing surface.

## Considered options

- Keep schedules only in the trigger store: the workflow and its schedule need separate backups and edits.
- Add a separate schedule file beside each workflow: there are still two files to move or review.
- Allow schedules in project copies: copying or checking out a repository could start paid work. One workflow name could mean several independent schedules.
- Replace Durable scheduling with a file-based scheduler: duplicates the admission, restart recovery and idempotency rules already implemented.
- Stop a trigger on every invalid edit: a temporary editor write could silently cancel tonight's work.

## Consequences

The daemon scans global files before it resumes tasks, watches the folder, and rescans every 60 seconds. It applies valid settings through the existing durable create, update, pause and resume operations. An invalid file keeps the last valid settings and reports a source-line diagnostic with attention. A missing file or removed schedule pauses future fires and keeps history. Reintroducing a valid unpaused block arms the trigger again from now.

The browser and the agent tool write the same schedule block. File saves use a text hash for optimistic conflict detection. YAML Document edits retain other front-matter keys, order and comments. Forgerie retains the newest 30 observed file versions under its data directory. Restore loads an old text version; saving it is a normal validated save.

A one-time migration writes stored schedules into eligible global workflows and re-keys each stored record to its file name. Incarnation, generation, pending occurrence, history and admitted fire request IDs survive the move. Durable migration intent permits restart after a file write but before re-keying. Ineligible records remain unchanged and generate diagnostics. This retains compatibility at the cost of keeping legacy store-backed triggers until an operator resolves them.

The file format permits one schedule per global workflow. To run different schedules, copy the workflow under different names. Versions consume disk space and are not a replacement for a backup. A folder watch is not reliable on every filesystem, so outside edits can take up to 60 seconds to appear.
