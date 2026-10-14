# Scheduled workflows

A trigger starts the same saved prose workflow in a new session of every target project, concurrently. Target projects are a fixed list of registered workspaces, or **All projects**. All projects uses one registered root per project, includes projects added later, and has no exceptions. Every project receives the same inputs, model, and thinking level. Each session keeps the name `<trigger name> · <local date>`, such as `Nightly refinement · Oct 13`. A workflow with a land stop waits for your review there. A workflow without one does not hold its result for landing.

Use the app-wide **Triggers** screen to create and edit schedules, inspect recent runs, pause or resume a trigger, and run it now. The attention count reports triggers with failed projects or missed fixed-target fires. A project whose folder is gone, is not a directory, or cannot resolve the workflow under All projects is recorded as unavailable, without attention. The same problem in a fixed target is a failure. One failure does not stop the other projects. **Mark as seen** clears attention. Opening the trigger, editing it, or running it now does not clear attention.

## Workflows and target projects

A project workflow in `<cwd>/.pi/prompts` replaces a global workflow of the same name in the agent profile's `prompts` folder. An invalid project override does not fall back to the global file.

The common-workflow list includes a name only if every target resolves it to a valid prose workflow with identical input declarations. Declarations include types, choices, defaults, and input descriptions; object-key order does not matter. Script workflows, missing workflows, and different declarations are excluded with diagnostics. The description comes from the first target's resolved workflow. `hasLandStop` is true only if every target's workflow has a land stop. The workflows can otherwise have different prose and stages.

Create and update apply the same common-workflow rule. They fill input defaults before saving the action. Fixed cwds must be existing workspaces of registered projects. The server resolves symlinks and removes duplicate canonical cwds. All projects uses the live registered roots, not every worktree. An unavailable root leaves no workflow common to all projects in the picker; existing All projects triggers still skip it when they fire.

Run now uses every target by default. An optional `cwd` restricts that fire to one fixed target, or any registered workspace under All projects. The restriction does not edit the trigger. All projects keeps its unavailable-project policy for this restricted fire. Triggers do not check for new commits. Put any no-work early finish in the workflow itself.

## Schedules and restarts

Schedules run daily or on selected weekdays, at `HH:mm` in an IANA time zone. The default zone is the daemon host's zone. For a spring clock change, a skipped time moves forward by the size of the gap. For an autumn clock change, a repeated time runs at its first instant only.

Sessiond owns the schedules. No browser connection is needed. The store is `triggers/state.sqlite` under `PI_WEB_DATA_DIR`. Only one daemon can own it. If opening it fails, trigger calls return 503 while other daemon features remain available. Check the sessiond log and fix the store problem before restarting.

On restart, occurrences that passed while sessiond was off fold into the latest occurrence. Earlier occurrences are counted in `skippedBefore`. A wake up to 60 seconds after the occurrence counts as on time, even with `missedGraceMinutes: 0`. Beyond that tolerance, the latest occurrence runs once only if it is within `missedGraceMinutes` (default 360), measured from the occurrence. The tolerance does not add 60 seconds to a longer grace window. Otherwise the occurrence is recorded as missed. With a zero-minute grace, a delay longer than 60 seconds is missed. Resume starts from now; occurrences during a deliberate pause do not run.

A running history entry, target snapshot, and admission receipt in the task checkpoint are saved in the same commit before the fire starts. All projects is resolved once per fire; a restart does not add projects to an already-admitted fire. Each project outcome is saved in the checkpoint as it settles. Recovery skips settled projects and retries only projects still running. The task receipt survives trimming the 50-entry display history. An admitted fire finishes after restart even if the trigger was paused or edited; deleting the trigger ends recovery for that incarnation. An interrupted fire reuses its captured action, request ID, session, and workflow launch receipt after restart. It replaces that entry with the outcome instead of adding another run. Failures keep the session ID and cwd if a session already exists. The session receives a saved failure message without starting a model turn, and becomes unread. Execution failures set attention even under All projects. Missed fixed-target fires set attention. Missed All projects fires remain recorded but do not set attention.

When upgrading version-1 tasks, the server preserves admission if the old running entry is still present. Version 1 did not store a task-owned receipt. If that old entry was already trimmed and the trigger is now paused or superseded, the server cannot prove admission. It records a recovery failure with attention instead of guessing and starting paid work. Use **Run now** to retry. Version-2 and version-3 task receipts do not have this limit.

The server migrates the version-1 trigger document to version 2 before resuming tasks. Each old `action.cwd` becomes `action.targets: {kind:"projects",cwds:[cwd]}`. Old history gains per-project outcomes; entries with a saved cwd keep it, and entries without one use the trigger's saved cwd. Revisions, incarnations, generations, and manual request receipts do not change. Scheduled and manual tasks migrate from versions 1 or 2 to version 3 without re-arming. Interrupted old fires retain their original single-project session UUID. New fires derive a distinct session UUID from the fire request ID and each project cwd.

## HTTP API

Browser requests use `/api`. Direct sessiond requests omit that prefix. JSON bodies are strict; unknown fields return 400. Errors are `{error, field?}`. A field error uses a dotted path, such as `schedule.at` or `action.workflow`.

| Method and path | Body or query | Result |
| --- | --- | --- |
| `GET /api/triggers` | None | `{triggers, attentionCount, timezone, timezones}`. Sorted by creation time and ID; up to 7 history entries each. |
| `GET /api/triggers/workflows?cwd=...` | Workspace cwd | `{workflows, diagnostics}` without creating a session. Each workflow declares `kind`, inputs, and `hasLandStop`. Scripts are listed but cannot be scheduled. |
| `POST /api/triggers/workflows/common` | `{kind:"projects",cwds:[...]}` or `{kind:"all"}` | `{workflows,diagnostics}`. Only common prose workflows, sorted by name. No session is created. Invalid fixed cwds return 400; unavailable All roots appear in diagnostics. |
| `GET /api/triggers/:id` | None | Trigger with up to 50 runs, newest first. |
| `POST /api/triggers` | Create object | 201 with the trigger. Optional ID; otherwise a lowercase name slug with collision suffixes. |
| `PATCH /api/triggers/:id` | `baseRevision` and changed fields | Updated trigger. A stale revision returns 409 with the current revision. Schedule or action edits re-arm active triggers. |
| `POST /api/triggers/:id/pause` | `{}` | Paused trigger. An already-started fire can finish. |
| `POST /api/triggers/:id/resume` | `{}` | Trigger armed from now. |
| `POST /api/triggers/:id/run` | `{requestId,cwd?}` | 202 `{requestId}` with the durable request ID. Works while paused and leaves the next scheduled fire unchanged. |
| `POST /api/triggers/:id/acknowledge` | `{}` | Trigger with attention cleared. |
| `DELETE /api/triggers/:id` | None | `{ok:true}`. Deletes history, not the sessions it made. |

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

The action accepts optional `model` (`provider/model-id`) and `thinkingLevel`. Omit them to use new-session defaults. The workspace, workflow, prose-only rule, and workflow inputs are checked at create, update, and fire time.

Each fire keeps `projects: [{cwd,outcome}]`. A project outcome is one of:

| Kind | Fields | Meaning |
| --- | --- | --- |
| `running` | `startedAt` | Launch is in progress or awaits restart recovery. |
| `started` | `sessionId`, `runId` | Session and workflow launch were accepted. This does not mean the workflow has finished. |
| `failed` | `error`, optional `sessionId` | Launch failed; the other projects can still start. |
| `unavailable` | `reason` | All projects skipped this project before launch. |
| `missed` | None | The occurrence passed outside the grace window. |

The existing `outcome` field is a derived fire summary. It stays `running` while projects settle. At completion it uses the first failure, otherwise the first started project, otherwise `unavailable`. Summary session fields link to only that first project; use `projects` to show all sessions. `triggerFireSummary` in the shared contract counts total, started, failed, unavailable, running, and missed outcomes for summaries such as "4 of 5 started".

A manual request ID has 1–64 letters, digits, or hyphens. The server returns an opaque durable ID encoded as `trigger-<id-length>-<id>-run-<token>`. The token is the first 32 hex digits of SHA-256 over the trigger incarnation and client request ID tuple. The ID length makes the encoding unambiguous. Use the ID from the 202 response to match history; do not reconstruct it from the client request ID. Durable admission receipts also use the incarnation/client request tuple, so deleting and recreating a trigger cannot reuse an old session. Reuse the same ID on a retry: it starts nothing new, including after restart. A new ID requests a new paid fire. The first accepted request captures its target restriction; reusing its ID does not change that selection.

Each trigger keeps `createdBy`: `{kind:"user"}` for HTTP creates, or `{kind:"agent",sessionId,cwd}` for tool creates. Its revision starts at 1 and increases with edits, state changes, acknowledgement, and fire admission, per-project progress, and completion. Every document change emits the global event `{type:"triggers.changed"}`; clients read the list again.

Status codes: 400 invalid input or action; 404 unknown trigger; 409 duplicate ID or stale revision; 503 store unavailable; 500 unexpected failure.

## Agent tool

Hosted sessions receive `workflow_schedule`. Every operation is limited to triggers with exactly one target workspace in the calling session's registered project, including its other workspaces. List hides All projects and multi-target triggers, even when they include the calling project. Create checks the destination; update checks both the existing and proposed destinations. Get, update, run, pause, resume, acknowledge, and delete refuse triggers that can reach another project or have more than one target. Browser routes remain daemon-wide. The tool creates triggers directly, without a confirmation card. All calls use one object with `action`: `list`, `create`, `update`, `pause`, `resume`, `delete`, or `run`.

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
