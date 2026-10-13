# Scheduled workflows

A trigger starts a saved prose workflow in a new session of a registered project's workspace. Each session keeps the name `<trigger name> · <local date>`, such as `Nightly refinement · Oct 13`. A workflow with a land stop waits for your review there. A workflow without one does not hold its result for landing.

Use the app-wide **Triggers** screen to create and edit schedules, inspect recent runs, pause or resume a trigger, and run it now. The attention count reports triggers with failed or missed runs. **Mark as seen** clears attention. Opening the trigger, editing it, or running it now does not clear attention.

## Schedules and restarts

Schedules run daily or on selected weekdays, at `HH:mm` in an IANA time zone. The default zone is the daemon host's zone. For a spring clock change, a skipped time moves forward by the size of the gap. For an autumn clock change, a repeated time runs at its first instant only.

Sessiond owns the schedules. No browser connection is needed. The store is `triggers/state.sqlite` under `PI_WEB_DATA_DIR`. Only one daemon can own it. If opening it fails, trigger calls return 503 while other daemon features remain available. Check the sessiond log and fix the store problem before restarting.

On restart, occurrences that passed while sessiond was off fold into the latest occurrence. Earlier occurrences are counted in `skippedBefore`. A wake up to 60 seconds after the occurrence counts as on time, even with `missedGraceMinutes: 0`. Beyond that tolerance, the latest occurrence runs once only if it is within `missedGraceMinutes` (default 360), measured from the occurrence. The tolerance does not add 60 seconds to a longer grace window. Otherwise the occurrence is recorded as missed. With a zero-minute grace, a delay longer than 60 seconds is missed. Resume starts from now; occurrences during a deliberate pause do not run.

A running history entry is saved before the fire starts. An interrupted fire reuses its request ID, session, and workflow launch receipt after restart. It replaces that entry with the outcome instead of adding another run. Failures keep the session ID and cwd if a session already exists. The session receives a saved failure message without starting a model turn, and becomes unread. Failures and missed occurrences also set attention.

## HTTP API

Browser requests use `/api`. Direct sessiond requests omit that prefix. JSON bodies are strict; unknown fields return 400. Errors are `{error, field?}`. A field error uses a dotted path, such as `schedule.at` or `action.workflow`.

| Method and path | Body or query | Result |
| --- | --- | --- |
| `GET /api/triggers` | None | `{triggers, attentionCount, timezone, timezones}`. Sorted by creation time and ID; up to 7 history entries each. |
| `GET /api/triggers/workflows?cwd=...` | Workspace cwd | `{workflows, diagnostics}` without creating a session. Each workflow declares `kind`, inputs, and `hasLandStop`. Scripts are listed but cannot be scheduled. |
| `GET /api/triggers/:id` | None | Trigger with up to 50 runs, newest first. |
| `POST /api/triggers` | Create object | 201 with the trigger. Optional ID; otherwise a lowercase name slug with collision suffixes. |
| `PATCH /api/triggers/:id` | `baseRevision` and changed fields | Updated trigger. A stale revision returns 409 with the current revision. Schedule or action edits re-arm active triggers. |
| `POST /api/triggers/:id/pause` | `{}` | Paused trigger. An already-started fire can finish. |
| `POST /api/triggers/:id/resume` | `{}` | Trigger armed from now. |
| `POST /api/triggers/:id/run` | `{requestId}` | 202 `{requestId}` with the durable request ID. Works while paused and leaves the next scheduled fire unchanged. |
| `POST /api/triggers/:id/acknowledge` | `{}` | Trigger with attention cleared. |
| `DELETE /api/triggers/:id` | None | `{ok:true}`. Deletes history, not the sessions it made. |

Create example:

```json
{
  "name": "Nightly refinement",
  "schedule": { "kind": "daily", "at": "03:00", "timezone": "America/Denver" },
  "action": {
    "kind": "workflow",
    "cwd": "/home/me/code/project",
    "workflow": "refine-backlog",
    "inputs": { "scope": "ready" }
  },
  "missedGraceMinutes": 360
}
```

The action accepts optional `model` (`provider/model-id`) and `thinkingLevel`. Omit them to use new-session defaults. The workspace, workflow, prose-only rule, and workflow inputs are checked at create, update, and fire time.

A manual request ID has 1–64 letters, digits, or hyphens. The server prefixes it as `trigger-<id>-run-<requestId>`. Reuse the same ID on a retry: it starts nothing new, including after restart. A new ID requests a new paid run.

Each trigger keeps `createdBy`: `{kind:"user"}` for HTTP creates, or `{kind:"agent",sessionId,cwd}` for tool creates. Its revision starts at 1 and increases with edits, state changes, acknowledgement, and fire start and completion. Every document change emits the global event `{type:"triggers.changed"}`; clients read the list again.

Status codes: 400 invalid input or action; 404 unknown trigger; 409 duplicate ID or stale revision; 503 store unavailable; 500 unexpected failure.

## Agent tool

Hosted sessions receive `workflow_schedule`. Every operation is limited to the calling session's registered project, including its other workspaces. List hides other projects. Create checks the destination; update checks both the existing and proposed destinations. Run, pause, resume, and delete refuse other projects' triggers. Browser routes remain daemon-wide. The tool creates triggers directly, without a confirmation card. All calls use one object with `action`: `list`, `create`, `update`, `pause`, `resume`, `delete`, or `run`.

- Create: `{action:"create", trigger:{name,schedule,action,missedGraceMinutes?}}`. The nested action is the workflow action above. Its cwd defaults to the calling session's cwd; schedule timezone defaults to the host's.
- Update: `{action:"update",id,changes:{baseRevision,...changedFields}}`.
- Pause, resume, delete: `{action,id}`.
- Run: `{action:"run",id,requestId?}`. Without a request ID, the tool derives one from the call ID.
- List: `{action:"list"}`.

Results give the next fire time in words and ISO format, or state that the trigger is paused. The Durable adapter registers this tool with `replay: "unsafe"`; an interrupted agent tool is not silently repeated.

## Costs and limits

Every fire costs a full workflow run. There is no per-run spend cap. The machine must be awake, and sessiond must run. For user units outside NixOS, see the [linger step](deployment.md#scheduled-triggers-with-no-login). Suspend can cause late or missed runs; Forgerie does not wake the host.

This slice supports no event triggers, cron, RRULE, or cross-host scheduling. Deleting a trigger removes the history that linked it to its sessions. Manual request receipts remain until deletion so even retries older than the retained 50 runs stay idempotent; these receipts use storage as manual runs accumulate.

## Acceptance check

```bash
TRIGGERS_REAL=1 nix shell nixpkgs#nodejs_24 -c npx tsx scripts/triggers-real.ts
```

This opt-in check uses provider tokens. It reads the local CLIProxyAPI configuration, copies it into a temporary profile, and removes that credential copy on exit. It owns a temporary Git workspace and an in-process loopback daemon. The production clock seam places a minute-resolution schedule four seconds ahead. The check restarts that daemon after workflow admission and proves one session, one journal, one workflow run, and a waiting land stop. It does not restart deployed services or land any work.
