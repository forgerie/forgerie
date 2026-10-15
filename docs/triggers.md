# Scheduled workflows

A trigger starts the same saved prose workflow in a new session of every target project, concurrently. Target projects are a fixed list of registered workspaces, or **All projects**. All projects uses one registered root per project, includes projects added later, and has no exceptions. Every project receives the same inputs, model, and thinking level. Each session keeps the name `<trigger name> · <local date>`, such as `Nightly refinement · Oct 13`. A workflow with a land stop waits for your review there. A workflow without one does not hold its result for landing.

Use the app-wide **Triggers** screen to create and edit schedules, inspect recent runs, pause or resume a trigger, and run it now. The attention count reports triggers with failed projects, missed fixed-target fires, or invalid schedule files. A project whose folder is gone, is not a directory, or cannot resolve the workflow under All projects is recorded as unavailable, without attention. The same problem in a fixed target is a failure. One failure does not stop the other projects. **Mark as seen** clears attention. Opening the trigger, editing it, or running it now does not clear attention.

## One file is the trigger

Put a `schedule:` block in a **global** workflow at `<agentDir>/prompts/<name>.md`. On this host, `agentDir` is `~/.local/share/forgerie/agent`. The trigger ID is `<name>`, not a slug of the display name. The workflow and its schedule now move and can be reviewed together.

```yaml
---
description: Review ready work each weekday
schedule:
  name: Nightly refinement
  at: "03:00"
  days: [mon, tue, wed, thu, fri]
  timezone: America/Denver
  projects: [Forgerie, /home/me/code/another]
  model: anthropic/claude-sonnet-4-5:high
  late: 6h
  inputs:
    scope: ready
workflow:
  version: 1
  inputs:
    scope: { type: string, default: ready }
  stages:
    - { id: land, name: Land, stop: land }
---
Review the selected work. Stop at land for the user's review.
```

| Schedule key | Meaning and default |
| --- | --- |
| `name` | Optional display name. Defaults to the file name. |
| `at` | Required local time, quoted `"HH:mm"`. |
| `days` | Optional unique weekdays: `sun`, `mon`, `tue`, `wed`, `thu`, `fri`, `sat`. Omit for every day. |
| `timezone` | IANA time zone. Defaults to the daemon host's zone. |
| `projects` | Required list of registered project names or absolute workspace paths, or `all`. Unknown or ambiguous names are invalid. Forgerie writes unique names and uses paths otherwise. |
| `model` | Optional coordinator `provider/model-id`, optionally followed by a known `:thinking-level`. Omit for the new-session default. |
| `late` | `"0"`, or a positive integer with `m`, `h` or `d`, at most 7 days. Defaults to `6h` (360 minutes). |
| `paused` | `true` stops future runs. Omit or set `false` to run. |
| `inputs` | Optional overrides of this file's `workflow.inputs` defaults. Required inputs still need values. Unknown inputs, wrong types and values outside choices are invalid. |

Unknown schedule keys are errors. A workflow has at most one schedule. To run it on two schedules, copy the workflow under another name. Only global files schedule. A block in `<cwd>/.pi/prompts` is ignored and appears in workflow-library diagnostics; it does not make a trigger.

## File sync, errors and versions

Sessiond scans global prompt files at start, before resuming durable tasks. It watches the folder with `fs.watch`, combines event bursts after 150 ms of quiet, and rescans every 60 seconds as a fallback. One background scan can run with at most one follow-up pending. Watch echoes whose file hashes already match the inline sync do not cause another full scan. Browser and agent edits write the global file, then sync it through the same durable scheduling operations. A changed schedule or action re-arms an active trigger. A prose-only edit does not re-arm it.

Each file-backed trigger response adds `file: {path,status,problem?,lastGoodAt?}`. This field is computed on read, not stored with the trigger. `problem` contains `message` and, when known, a one-based `line`.

| File status | Effect |
| --- | --- |
| `ok` | The valid file's settings run. `lastGoodAt` reports the last valid read. |
| `invalid` | The last good settings keep running. The trigger counts in attention. Fix the reported file and line; **Mark as seen** does not hide a file error. A new invalid file with no last good trigger is reported in the daemon log. |
| `missing` | The file or its schedule block is gone. The trigger pauses and keeps history. Restoring a valid unpaused block resumes from now. |

Forgerie saves copies of observed file text in `triggers/versions/<name>/` under `PI_WEB_DATA_DIR`. It keeps the newest 30 versions. Versions include Forgerie saves (`forgerie`), outside edits found by sync (`outside`), and upgrade writes (`migration`). Duplicate successive text is not saved twice. File deletion does not delete these copies. Restoring a version loads its text into the editor; Save still validates it and checks the current file hash. Linked and hard-linked workflow files can be read, but saves refuse them.

On the first start after this upgrade, each stored trigger with an unscheduled global workflow gets its schedule written there. Its ID becomes the workflow's file name. A paused trigger gets `paused: true`. History, attention, creation identity, pending occurrences, admitted fire identities, incarnation and generation are retained. A durable intent recovers an interrupted migration without scheduling a second fire. Records with no suitable global file, project-only resolutions, conflicting schedules, or name collisions remain unchanged and are reported in the daemon log. The migration does not run again after completion; removing a migrated block later pauses the trigger rather than recreating it.

For example, a stored `nightly-architecture` that runs global `nightly-maintenance` becomes `nightly-maintenance`. A paused `nightly-refinement` that runs `nightly-refine` becomes `nightly-refine` with `paused: true`. [ADR 0009](adr/0009-schedules-live-in-workflow-files.md) records the decision.

## Workflows and target projects

A project workflow in `<cwd>/.pi/prompts` replaces a global workflow of the same name in the agent profile's `prompts` folder. An invalid project override does not fall back to the global file.

The common-workflow list includes a name only if every target resolves it to a valid prose workflow with identical input declarations. Declarations include types, choices, defaults, and input descriptions; object-key order does not matter. Script workflows, missing workflows, and different declarations are excluded with diagnostics. Common-workflow diagnostics include `reason` (`missing`, `script`, `unreadable`, or `inputs-differ`) and `cwds`. Input mismatch diagnostics identify both the reference project and the differing project. Clients use these fields instead of parsing the display text. The existing per-cwd GET keeps its `{name,path,error}` diagnostic shape. The description comes from the first target's resolved workflow. `hasLandStop` is true only if every target's workflow has a land stop. The workflows can otherwise have different prose and stages.

The existing create and update API applies the same common-workflow rule. File schedules validate inputs against their own global workflow definition. Fixed cwds must be existing workspaces of registered projects. The server resolves symlinks and removes duplicate canonical cwds. All projects uses the live registered roots, not every worktree. An unavailable root leaves no workflow common to all projects in the picker; existing All projects triggers still skip it when they fire.

Run now uses every target by default. An optional `cwd` restricts that fire to one fixed target, or any registered workspace under All projects. The restriction does not edit the trigger. All projects keeps its unavailable-project policy for this restricted fire. Triggers do not check for new commits. Put any no-work early finish in the workflow itself.

## Schedules and restarts

Schedules run daily or on selected weekdays, at `HH:mm` in an IANA time zone. The default zone is the daemon host's zone. For a spring clock change, a skipped time moves forward by the size of the gap. For an autumn clock change, a repeated time runs at its first instant only.

Sessiond owns the schedules. No browser connection is needed. The store is `triggers/state.sqlite` under `PI_WEB_DATA_DIR`. Only one daemon can own it. If opening it fails, trigger calls return 503 while other daemon features remain available. Check the sessiond log and fix the store problem before restarting.

On restart, occurrences that passed while sessiond was off fold into the latest occurrence. Earlier occurrences are counted in `skippedBefore`. A wake up to 60 seconds after the occurrence counts as on time, even with `missedGraceMinutes: 0`. Beyond that tolerance, the latest occurrence runs once only if it is within `missedGraceMinutes` (default 360), measured from the occurrence. The tolerance does not add 60 seconds to a longer grace window. Otherwise the occurrence is recorded as missed. With a zero-minute grace, a delay longer than 60 seconds is missed. Resume starts from now; occurrences during a deliberate pause do not run.

A running history entry, target snapshot, and admission receipt in the task checkpoint are saved in the same commit before the fire starts. All projects is resolved once per fire; a restart does not add projects to an already-admitted fire. Each project outcome is saved in the checkpoint as it settles. Recovery skips settled projects and retries only projects still running. The task receipt survives trimming the 50-entry display history. An admitted fire finishes after restart even if the trigger was paused or edited; deleting the trigger ends recovery for that incarnation. An interrupted fire reuses its captured action, request ID, session, and workflow launch receipt after restart. It replaces that entry with the outcome instead of adding another run. Failures keep the session ID and cwd if a session already exists. The session receives a saved failure message without starting a model turn, and becomes unread. Execution failures set attention even under All projects. Missed fixed-target fires set attention. Missed All projects fires remain recorded but do not set attention.

When upgrading version-1 tasks, the server preserves admission if the old running entry is still present. Version 1 did not store a task-owned receipt. If that old entry was already trimmed and the trigger is now paused or superseded, the server cannot prove admission. It records a recovery failure with attention instead of guessing and starting paid work. Use **Run now** to retry. Version-2 and version-3 task receipts do not have this limit.

The server migrates the version-1 trigger document to version 2 before resuming tasks. Each old `action.cwd` becomes `action.targets: {kind:"projects",cwds:[cwd]}`. Old history gains per-project outcomes; entries with a saved cwd keep it, and entries without one use the trigger's saved cwd. Revisions, incarnations, generations, and manual request receipts do not change. Scheduled and manual tasks migrate from versions 1 or 2 to version 3 without re-arming. Interrupted old fires retain their original single-project session UUID. New fires derive a distinct session UUID from the fire request ID and each project cwd.

## HTTP API

Browser requests use `/api`. Direct sessiond requests omit that prefix. JSON bodies are strict; unknown fields return 400. Errors are `{error, field?, line?}`. A field error uses a dotted path, such as `schedule.at` or `action.workflow`.

| Method and path | Body or query | Result |
| --- | --- | --- |
| `GET /api/triggers` | None | `{triggers, attentionCount, timezone, timezones}`. Sorted by creation time and ID; up to 7 history entries each. |
| `GET /api/triggers/workflows?cwd=...` | Workspace cwd | `{workflows, diagnostics}` without creating a session. Each workflow declares `kind`, inputs, and `hasLandStop`. Scripts are listed but cannot be scheduled. |
| `POST /api/triggers/workflows/common` | `{kind:"projects",cwds:[...]}` or `{kind:"all"}` | `{workflows,diagnostics}`. Only common prose workflows, sorted by name. No session is created. Invalid fixed cwds return 400; unavailable All roots appear in diagnostics. |
| `GET /api/triggers/:id` | None | Trigger with up to 50 runs, newest first. |
| `GET /api/triggers/:id/file` | None | `{path,text,sha256,modifiedAt,schedule,definition,body}`. Invalid blocks read as null; text remains available for repair. |
| `PUT /api/triggers/:id/file` | `{text,baseSha256,schedule?}` | `{trigger,document}` with the updated trigger after sync and the saved file document. Optional `schedule` replaces the block while retaining other keys, order and comments. Refuses invalid workflow or schedule with 400 and `line` when known. Stale hash: 409. |
| `GET /api/triggers/:id/versions` | None | `{versions:[{id,savedAt,source,sha256}]}`, newest first, at most 30. |
| `GET /api/triggers/:id/versions/:versionId` | None | Version metadata plus `text`. |
| `POST /api/triggers` | Create object | 201 with the trigger. Needs an existing global workflow with no schedule. Its file name is the ID; a supplied legacy `id` does not rename it. |
| `PATCH /api/triggers/:id` | `baseRevision` and changed fields | Updated trigger. A stale revision returns 409 with the current revision. Schedule or action edits re-arm active triggers. |
| `POST /api/triggers/:id/pause` | `{}` | Paused trigger. An already-started fire can finish. |
| `POST /api/triggers/:id/resume` | `{}` | Trigger armed from now. |
| `POST /api/triggers/:id/run` | `{requestId,cwd?}` | 202 `{requestId}` with the durable request ID. Works while paused and leaves the next scheduled fire unchanged. |
| `POST /api/triggers/:id/acknowledge` | `{}` | Trigger with attention cleared. |
| `DELETE /api/triggers/:id` | None | `{ok:true}`. Removes the schedule block and deletes the record and history, not the workflow prose, versions or sessions. |

**Server side:** `PUT /triggers/:id/file` syncs the saved file before returning `{trigger,document}`. The trigger includes the updated schedule, next run or paused state, and computed `file.status`. Its response schema is `TriggerFileSavedSchema` in `src/shared/triggers.ts`; the file schemas stay in `src/shared/triggerFiles.ts` to avoid an import cycle. `GET /triggers/:id/file` still returns the document alone.

Create example:

```json
{
  "name": "Nightly refinement",
  "schedule": { "kind": "daily", "at": "03:00", "timezone": "America/Denver" },
  "action": {
    "kind": "workflow",
    "targets": { "kind": "projects", "cwds": ["/home/me/code/project", "/home/me/code/another"] },
    "workflow": "refine-backlog",
    "inputs": { "scope": "ready" }
  },
  "missedGraceMinutes": 360
}
```

Use `"targets": {"kind":"all"}` for All projects. `action.cwd` is no longer accepted in request bodies.

The action accepts optional `model` (`provider/model-id`) and `thinkingLevel`. A file schedule needs an explicit model when setting a thinking level. Omit them to use new-session defaults. The workspace, workflow, prose-only rule, and workflow inputs are checked at create, update, and fire time. File-backed updates cannot change `action.workflow`; copy or rename the workflow file instead.

Each fire keeps `projects: [{cwd,outcome}]`. A project outcome is one of:

| Kind | Fields | Meaning |
| --- | --- | --- |
| `running` | `startedAt` | Launch is in progress or awaits restart recovery. |
| `started` | `sessionId`, `runId` | Session and workflow launch were accepted. This does not mean the workflow has finished. |
| `failed` | `error`, `failedAt`, optional `sessionId` | Launch failed; the other projects can still start. |
| `unavailable` | `reason` | All projects skipped this project before launch. |
| `missed` | `missedAt` | The occurrence passed outside the grace window. |

New project failures record `failedAt` in the same transaction and from the same clock sample as `attention.since`. Missed projects record `missedAt` equal to the fire's `recordedAt`. These timestamps are preserved across recovery. Both fields are optional on read so old documents and task checkpoints remain valid; old times are not backfilled. A client can compare a known `failedAt` to `attention.since` to exclude an acknowledged failure inside a still-running fire.

The existing `outcome` field is a derived fire summary. It stays `running` while projects settle. At completion it uses the first failure, otherwise the first started project, otherwise `unavailable`. Summary session fields link to only that first project; use `projects` to show all sessions. `triggerFireSummary` in the shared contract counts total, started, failed, unavailable, running, and missed outcomes for summaries such as "4 of 5 started".

A manual request ID has 1–64 letters, digits, or hyphens. The server returns an opaque durable ID encoded as `trigger-<id-length>-<id>-run-<token>`. The token is the first 32 hex digits of SHA-256 over the trigger incarnation and client request ID tuple. The ID length makes the encoding unambiguous. Use the ID from the 202 response to match history; do not reconstruct it from the client request ID. Durable admission receipts also use the incarnation/client request tuple, so deleting and recreating a trigger cannot reuse an old session. Reuse the same ID on a retry: it starts nothing new, including after restart. A new ID requests a new paid fire. The first accepted request captures its target restriction; reusing its ID does not change that selection.

Each trigger keeps `createdBy`: `{kind:"user"}` for HTTP creates, or `{kind:"agent",sessionId,cwd}` for tool creates. Its revision starts at 1 and increases with edits, state changes, acknowledgement, and fire admission, per-project progress, and completion. Every document change emits the global event `{type:"triggers.changed"}`; clients read the list again.

Status codes: 400 invalid input, file or action; 404 unknown trigger, missing file or unknown version; 409 stale revision or file hash; 503 store unavailable; 500 unexpected failure.

## Agent tool

Hosted sessions receive `workflow_schedule`. Every operation is limited to triggers with exactly one target workspace in the calling session's registered project, including its other workspaces. List hides All projects and multi-target triggers, even when they include the calling project. Create checks the destination; update checks both the existing and proposed destinations. Get, update, run, pause, resume, acknowledge, and delete refuse triggers that can reach another project or have more than one target. Browser routes remain daemon-wide. The tool writes the same global schedule block, without a confirmation card. Create needs an existing unscheduled global workflow. All calls use one object with `action`: `list`, `create`, `update`, `pause`, `resume`, `delete`, or `run`.

- Create: `{action:"create", trigger:{name,schedule,action,missedGraceMinutes?}}`. The nested action is the workflow action above. Its targets default to `{kind:"projects",cwds:[callingCwd]}`. All projects and lists with more than one cwd are refused; schedule timezone defaults to the host's.
- Update: `{action:"update",id,changes:{baseRevision,...changedFields}}`.
- Pause, resume, delete: `{action,id}`.
- Run: `{action:"run",id,requestId?}`. Without a request ID, the tool derives one from the call ID.
- List: `{action:"list"}`.

Results give the next fire time in words and ISO format, or state that the trigger is paused. The Durable adapter registers this tool with `replay: "unsafe"`; an interrupted agent tool is not silently repeated.

## Costs and limits

Every started project costs a full workflow run. A fire starts all projects at once, so token use and model quota demand increase with the number of target projects. There is no per-run spend cap. The machine must be awake, and sessiond must run. For user units outside NixOS, see the [linger step](deployment.md#scheduled-triggers-with-no-login). Suspend can cause late or missed runs; Forgerie does not wake the host.

This slice supports no event triggers, cron, RRULE, or cross-host scheduling. Deleting a trigger removes the history that linked it to its sessions. Manual request receipts remain until deletion so even retries older than the retained 50 runs stay idempotent; these receipts use storage as manual runs accumulate.

## Acceptance check

```bash
TRIGGERS_REAL=1 nix shell nixpkgs#nodejs_24 -c npx tsx scripts/triggers-real.ts
```

This opt-in check uses provider tokens. It reads the local CLIProxyAPI configuration, copies it into a temporary profile, and removes that credential copy on exit. It owns a temporary Git workspace and an in-process loopback daemon. The production clock seam places a minute-resolution schedule four seconds ahead. The check restarts that daemon after workflow admission and proves one session, one journal, one workflow run, and a waiting land stop. It does not restart deployed services or land any work.
