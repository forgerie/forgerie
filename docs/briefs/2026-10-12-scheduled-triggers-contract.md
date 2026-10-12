---
date: 2026-10-12
topic: scheduled-triggers
artifact: contract
---

# Scheduled triggers: server and route contract

A trigger starts a saved prose workflow at a set time, in a new session of a
project. The user reviews the result in the morning at the run's land card.
This contract wires the existing trigger core into sessiond and defines what
the browser and agents can call.

## What already exists on main

| File | Contract kept |
| --- | --- |
| `src/shared/triggerSchedules.ts` | `TriggerScheduleSchema`, `parseTriggerSchedule()`, `nextOccurrence()`. Daily or weekly `HH:mm` in an IANA zone. DST: a skipped time moves forward by the gap; a repeated time fires at its first instant. |
| `src/shared/triggers.ts` | Trigger, action, fire, and state schemas. `triggerRequestId(id, occurrence)` returns `trigger-<id>-<ms>`. |
| `src/server/triggers/durableTriggers.ts` | One background Durable task per active trigger. Sleep, fold missed occurrences, apply `missedGraceMinutes` (default 360), fire through an injected `FireTrigger`, record, re-arm. Pause, resume, remove are single commits keyed by `generation`. |

## Changes to the shared schemas

1. `TriggerFire` gains `cause: "schedule" | "manual"`.
2. `TriggerAction` gains optional `model` (strict `provider/model-id`, the same
   form as `POST /sessions` `modelSpec`) and optional `thinkingLevel`. Absent
   means the server defaults for a new session.
3. `Trigger` gains `attention: { since: number } | null`. It is set when a fire
   records `failed` or `missed` and no earlier unacknowledged problem exists. It
   is cleared by the acknowledge route. It drives the attention count.
4. `TriggerFire` `started` outcome keeps `sessionId` and `runId`, and gains `cwd`.
5. Add `TriggerUpdateSchema`: optional `name`, `schedule`, `action`,
   `missedGraceMinutes`. Additional properties are refused.

Put new request and response schemas in `src/shared/triggers.ts`. The browser
imports only from `src/shared/triggers.ts` and `src/shared/triggerSchedules.ts`.

## Storage

- Path: `join(piWebDataDir(env), "triggers", "state.sqlite")`.
- Open with `acquireDurableOwnership(path)`, then `openNodeSqliteStorage()`,
  then `Harness.open()` with a registry that installs only the triggers
  extension. `models` is `createModels()`; trigger tasks make no model calls.
- Do not use `DurableJournalPool`. The pool manages session families: logical
  bindings, fork leases, and catalog locators. The trigger storage is one
  daemon-wide store with no session semantics. It still gets the same kernel
  lock, so a second daemon cannot open it.
- The root conversation is the anchor that owns every trigger task.
- Startup: open the store after `PiSessionService` exists, then call
  `harness.resume()`. Sleeping triggers resume with no browser connected.
- Shutdown: close the trigger harness before `sessions.dispose()`. A fire in
  progress is cancelled and reruns at the next start with the same request ID.
- A failure to open the store is logged and fails only the trigger routes with
  503. It does not stop sessiond.
- Wrap the store in one module, `src/server/triggers/triggerService.ts`. Routes,
  the agent tool, and sessiond use only that service.

## The fire step

`FireTrigger` receives `{triggerId, name, action, occurrence, requestId}`. It
must be idempotent on `requestId`, because Durable reruns an interrupted fire.

1. **Deterministic session ID.** Derive the session ID from `requestId`: a
   UUIDv7 whose 48-bit time field is `occurrence` and whose other bits come from
   `sha256(requestId)`, with the version and variant bits set. The SDK already
   accepts `SessionManager.create(cwd, dir, { id })`. Add an internal
   `sessionId` option to `PiSessionService.startSession()` and the gateway
   `create()`; do not expose it on the public `POST /sessions` route.
2. **Find or create.** If a session with that ID exists in `action.cwd`, reuse
   it. Otherwise create it with the action's model and thinking level.
3. **Name it.** `<trigger name> · <local date of occurrence>`, for example
   `Nightly refinement · Oct 13`. The session title generator must not rename it.
4. **Start the workflow.** `runWorkflow(ref, action.workflow, action.inputs,
   requestId)`. Durable launch receipts refuse a second run for the same request
   ID in that session and return the accepted run.
5. **Return** `{sessionId, cwd, runId}`.

Required proof: a real restart test where the daemon stops after step 2 and
again after step 4. Each case ends with exactly one session file with that ID,
one Durable journal for it, and one workflow run. If the SDK writes no file
before the first message, the test must show that a rerun does not leave an
orphan `.durable/` directory either.

Validation at create and at update: `action.cwd` is a workspace of a registered
project, the workflow exists in that cwd's workflow library, it is a prose
workflow (not a script), and the inputs pass that workflow's input rules. A bad
action returns 400 at create. At fire time the same checks run again; a
failure is recorded as `failed` with the reason.

## Failure visibility

Session notifications are in memory and tied to a live runtime generation, so
they do not survive a restart. They are not used for triggers.

- **The fire failed after the session exists** (workflow missing, inputs
  invalid, launch refused): append a persisted custom message
  `customType: "forgerie:trigger"`, `display: true`, no model turn, to that
  session. It states the trigger, the occurrence, and the error. The session
  shows as unread in the session list.
- **The fire failed before a session exists, or an occurrence was missed**:
  recorded in the trigger history and in `attention`.
- **Attention count**: `GET /triggers` returns `attentionCount`, the number of
  triggers with `attention !== null`. The browser shows it on the entry point to
  the triggers screen.
- Every change to the trigger document publishes the global event
  `{ type: "triggers.changed" }` through `SessionEventHub.publishGlobal`. The
  browser reads the list again.

## Routes

Browser paths use the `/api` prefix. Sessiond uses them without it. Bodies are
strict: extra fields return 400. Errors have shape `{error: string}`.

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /triggers` | none | `{triggers: Trigger[], attentionCount: number, timezone: string}`. `timezone` is the daemon host's zone, a default for the create form. Sorted by `createdAt`, then `id`. |
| `GET /triggers/:id` | none | `Trigger`, with history newest first (at most 50). |
| `POST /triggers` | `TriggerCreate` | 201 `Trigger`. 409 if the ID exists. |
| `PATCH /triggers/:id` | `TriggerUpdate` | `Trigger`. A schedule or action change re-arms with a new generation. History is kept. |
| `POST /triggers/:id/pause` | `{}` | `Trigger`. Idempotent. |
| `POST /triggers/:id/resume` | `{}` | `Trigger`. Re-arms from now. Idempotent. |
| `POST /triggers/:id/run` | `{requestId}` (1 to 64 letters, digits, hyphens) | 202 `{requestId: string}`. Creates a durable one-shot fire task with request ID `trigger-<id>-run-<requestId>` and `cause: "manual"`. Repeating the same `requestId` returns the same result and starts nothing new. Does not change `nextFireAt`. Works on a paused trigger. |
| `POST /triggers/:id/acknowledge` | `{}` | `Trigger` with `attention: null`. |
| `DELETE /triggers/:id` | none | `{ok: true}`. History is deleted with it. Sessions it created stay. |

Status codes: 400 invalid body or action, 404 unknown trigger, 409 duplicate
ID or a conflicting state, 503 store unavailable, 500 unexpected.

## Agent tool

Tool name `workflow_schedule`, registered on hosted Durable sessions like the
other Forgerie session tools. One object parameter with an `action`:
`list`, `create`, `update`, `pause`, `resume`, `delete`, `run`. It calls
`triggerService`, not HTTP. `create` defaults `action.cwd` to the calling
session's cwd and `schedule.timezone` to the daemon zone. The tool result
states the next fire time in words and in ISO form. `replay: "unsafe"`.

The tool creates triggers directly. It does not need the user's approval
(open decision 1).

## Docs and checks

- `docs/triggers.md`: what triggers do, the screen, the routes, the tool,
  restart and missed-run behaviour, DST, costs, and limits. Link it from the
  docs index in `README.md`.
- `docs/deployment.md`: `loginctl enable-linger <user>` for hosts that run
  sessiond as a systemd user unit outside NixOS, so triggers fire with nobody
  logged in. Suspend is not covered: a sleeping machine fires late, after it
  wakes.
- `scripts/triggers-real.ts` (`TRIGGERS_REAL=1`): real model, temporary profile
  and Git workspace, in-process daemon. A trigger a few seconds ahead starts a
  staged workflow that ends at a land stop. The daemon restarts during the fire.
  The script checks one session, one run, and the run waiting at its land stop.

## Limits of this slice

- No event triggers, cron, or RRULE.
- No per-run spend cap. Each fire costs one full workflow run.
- No wake from suspend.
- One daemon owns the store. There is no cross-host scheduling.

## Open decisions for the user

1. The agent tool creates triggers without asking the user. Alternative: the
   tool proposes a trigger as a card, and the user confirms it.
2. A missed occurrence (past the 6-hour grace) is recorded, not fired.
   Alternative: always fire late.
3. Deleting a trigger deletes its history. Alternative: keep a tombstone.
