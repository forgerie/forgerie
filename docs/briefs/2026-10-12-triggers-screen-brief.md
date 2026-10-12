---
date: 2026-10-12
topic: scheduled-triggers
artifact: design brief
contract: docs/briefs/2026-10-12-scheduled-triggers-contract.md
---

# Triggers screen: design brief

## The problem

A trigger starts a saved workflow at night. In the morning the user opens the
session that the run made and decides at its land card. The session list
already shows that session as waiting for you. So **when a night goes well,
the user does not need this screen.** The user needs it in two cases: to set up
and change triggers, and when a night did not make a session (it failed or it
was missed). The screen must be calm by default and clear about failures.

Mobbin was not searched. This runtime has no Mobbin tools. The direction comes
from patterns that already ship in this app: the Backlog view, the agent
editor, and the session list.

## Direction

The triggers screen is a log of nights, kept in the app's existing quiet
system. It takes the thread's place, as Backlog and Settings do, and uses
their header, reading column, group headers, and rows. The screen adds one new
visual device: the **run strip**. Each trigger row has a short line of
marks, one per recent run, oldest on the left. A filled dot is a run that
started a session. A square in the bad tone is a run that failed. A ring in
the warn tone is a run that was missed. The user sees in one look whether the
last week went well. No other new colour, surface, or font appears. A run
that started a session gets no green: the land card decides if the work was
good, not the trigger. The copy talks about times and runs ("Every night at
3:00 AM", "Missed Oct 12, 3:00 AM"). It does not use cron words.

## Token plan

Reuse only. Every value below is already in `ui/src/ui/theme.css` and has a
dark variant in its `prefers-color-scheme: dark` block.

| Role | Token | Use |
| --- | --- | --- |
| Page, column | `--background`, `.settings-scroll`, `.settings-column` (max `--thread-max-width` 42rem) | The screen's surface and reading column |
| Rows | `--hover-surface`, `--active-surface`, `--radius-control`, `--control-size` | Row press states and hit size |
| Group rules | `.picker-group-header`, `--line` | "Needs a look", "Active", "Paused" |
| Primary text / quiet text | `--foreground` / `--muted-foreground`, `--faint-foreground` | Name / schedule, project, workflow; paused rows |
| Started mark | `--muted-foreground`, filled circle | Run strip, history rows |
| Failed mark | `--destructive`, filled square (1px radius, like `.picker-row[data-state="errored"]`) | Run strip, row mark, history status |
| Missed mark | `--tone-warn`, 1.5px ring, no fill | Run strip, row mark |
| Starting (local, after Run now) | `--live` ring with `picker-pulse`, still under reduced motion | Run strip end, history row |
| Attention chip, failed | `--destructive` text on `--destructive-wash` | Picker footer count |
| Attention chip, missed only | `--ink-warn` on `--warn-wash` | Picker footer count |
| Body face | `--body-font` (Public Sans), `--small-text` for names, `--label-text` for meta | All copy |
| Code face | `--code-font` (JetBrains Mono) | Error text, trigger ID, and the row time slot (the existing `.picker-time` convention) |
| Title | `.agent-name` (display font, `clamp(1.375rem, 4.5cqi, 1.75rem)`) | Trigger name on its page |
| Mark size | `--tally-mark` (0.4375rem), gap `--pip-gap` | Run strip |

Shape and colour both carry each outcome, so the strip reads without colour.
Meta parts are separated by `--space-3` gaps, as in `.bl-meta`, not by
middle dots. No label uses all capitals.

## 1. Where it lives

### How the app is organized today (verified)

- `ui/src/App.tsx` has one thread area. A session (`ForgerieSession`),
  Settings (`SettingsView`), or the Backlog (`BacklogView`) takes that area.
  Each one keeps its place in the URL (`?session=`, `?settings=`, `?backlog=`),
  and opening one of them clears the others (`clearSettings`).
- The session list (`ui/src/ui/Picker.tsx`) ends in `.picker-footer`, one row
  with **Backlog** (with an open-item count in `.picker-footer-count`),
  **Settings**, and an icon-only **Full screen** toggle. These are the app-wide
  places. The session header (`SessionFrame`, `WorkflowOpener`,
  `ChildAgentsOpener`) holds only controls for that one session.
- Worktree cleanup is not an app-wide place. It opens from the child-agents
  panel of a session (`childAgents.openCleanup()` in
  `ui/src/ForgerieSession.tsx`).
- Every Fold 8 posture is narrower than `DOCK_MIN_WIDTH` (1000px,
  `ui/src/ui/AppShell.tsx`). On the Fold, the session list is a sheet over the
  thread, and the opener button in the header carries a dot
  (`.app-opener[data-attention]`) when a session waits on you.

### Decision

**Triggers is a third app-wide place, beside Backlog in the session-list
footer, and it takes the thread's place as Backlog does.** Reasons:

1. Triggers are app-wide, across projects, like the backlog. They do not
   belong to one session, so they do not go in the session header.
2. In the morning the user opens the app at the session list. With nothing
   selected, the list opens by itself. The night's session is in that list. The
   footer entry and its count are on the same surface, so a failed night shows
   where the user already looks.
3. Settings holds configuration that seldom changes. Triggers have live state
   and failures. If Triggers were in Settings, the count would have to show on
   "Settings", and a count there does not say what to look at.

### URL places

| URL | Shows |
| --- | --- |
| `?triggers` | The list |
| `?triggers&create` | The create page |
| `?triggers=<id>` | One trigger's page: status, settings to edit, runs |

Do not use `new` as a param or value. `?new=` is already the new-session
dialog (`readNew` in `App.tsx`), and `new` is also a valid trigger ID. Add
`triggers` and `create` to `clearSettings`, so Settings, Backlog, and Triggers
replace each other. Back and reload return to the same place, as for Backlog.

### The entry and its count

`attentionCount` from `GET /triggers` shows as a chip on the entry,
`.picker-footer-count` with `data-tone`. It shows only when the count is above
zero. A zero gives the user nothing to act on.

| State | Chip | Accessible name and title |
| --- | --- | --- |
| No attention | none | "Triggers" |
| `attentionCount` 2, at least one latest problem failed | `2`, bad tone | "Triggers: 2 need a look" |
| `attentionCount` 1, all missed | `1`, warn tone | "Triggers: 1 needs a look" |
| Store unavailable (503) | `Off`, bad tone | "Triggers are off" |
| Not read yet | none | "Triggers" |

The list hook (`useTriggerList`, like `useBacklogList`) lives in `App.tsx`, not
in the screen. This keeps the count up to date while the screen is closed.
It reads `GET /triggers` again on each `triggers.changed` global event. Today
the picker's machine socket in `ui/src/picker/catalogStore.ts` drops event
types it does not know. It needs a listener for `triggers.changed`, the same
way it has one for worktree events.

### Footer room

The footer is already full. At an 18rem picker it has about 272px inside.
Backlog with its count needs about 116px, Settings about 94px, and Full screen
44px (estimated, not measured). A fourth item fits only if something else
gives way. The footer layout is a function of the footer's own width:

```ts
const FOOTER_ALL_LABELS = 25 * REM;  // guess until measured
const FOOTER_ICONS_ONLY = 14 * REM;  // guess until measured
function footerPlan(innerWidth: number) {
  if (innerWidth >= FOOTER_ALL_LABELS) return { labelled: ["backlog", "triggers", "settings"], fullScreen: "inline" };
  if (innerWidth >= FOOTER_ICONS_ONLY) return { labelled: ["backlog", "triggers"], settings: "icon", fullScreen: "menu" };
  return { labelled: [], backlog: "icon+count", triggers: "icon+count", settings: "icon", fullScreen: "menu" };
}
```

```
footer ≥ 25rem   | [=] Backlog 12 | [@] Triggers 2 | [*] Settings | [#] |
14rem – 25rem    | [=] Backlog 12 | [@] Triggers 2 | [*] |        Full screen → picker ⋯ menu
< 14rem          | [=] 12 | [@] 2 | [*] |                        Full screen → picker ⋯ menu
```

The picker is at most 18rem wide today, so the middle tier is the normal one.
Full screen moves into the picker's ⋯ menu as a `menuitemcheckbox`
"Full screen". Settings keeps its gear, its `aria-label`, and its title.
Triggers uses lucide `CalendarClockIcon`. Counts truncate before names, as
they do now. This changes how many taps two existing controls need (open
question 1).

## 2. The trigger list

### Groups and order

The server sorts by `createdAt`. The browser groups and sorts the list again:

| Group | Contains | Order |
| --- | --- | --- |
| Needs a look | `attention !== null`, active or paused | Newest `attention.since` first |
| Active | `state.kind === "active"`, no attention | Soonest `nextFireAt` first |
| Paused | `state.kind === "paused"`, no attention | Name, A to Z |

The groups use `.picker-group` and `.picker-group-header` with a count and
collapse, as in `BacklogView.tsx`. An empty group is not drawn.

### Row anatomy

The row is one press target that opens the trigger's page. A ⋯ button sits
beside it. Use the grid of `.bl-row`: mark column `0.875rem`, content, and an
end column.

```
 mark  line 1  Name                                         time slot
       line 2  Schedule words   Project   Workflow
       line 3  Run strip  Last outcome …          [state action]  [⋯]
```

| Part | Content | Source |
| --- | --- | --- |
| Mark | Bad square if attention and the latest problem failed. Warn square if missed only. Empty otherwise. | `attention`, `history` |
| Name | `name`, up to 2 lines (`.bl-title` clamp) | `name` |
| Time slot | Active: relative next fire, "in 9 h", "in 25 min", "due now". Paused: "Paused". Code face, as `.picker-time`. | `state` |
| Schedule words | See the rules below. | `schedule`, list `timezone` |
| Project | Project name from `destinationLabel(cwd, projects)` (`ui/src/newSession.ts`). If the folder is not a known project, show the folder's last path segment, with the full path as title. | `action.cwd` |
| Workflow | The workflow name as saved, for example `refine-backlog` | `action.workflow` |
| Run strip | Up to 7 marks (5 in the narrow tier), oldest on the left. Past the limit, `visibleMarks()` from `ui/src/ui/TallyRow.tsx` gives a `+n` count in the worst hidden tone. If there are no runs, nothing is drawn. | `history` |
| Last outcome | See the outcome words below. One line, truncates. | `history[0]` |
| State action | "Mark as seen" when attention is set. "Resume" when paused. Nothing for an active trigger. Inline only in the wide tier. In other tiers it is the first item in ⋯. | `attention`, `state` |
| ⋯ | Row menu (below) | |

The row's accessible name includes the strip in words, for example "Nightly
refinement. Every night at 3:00 AM. Next run in 9 hours. Last 7 runs: 5
started, 2 failed."

### Schedule words (`scheduleWords`, pure, unit-tested)

| Schedule | Words |
| --- | --- |
| daily, `at` from 21:00 to 04:59 | "Every night at 3:00 AM" |
| daily, other times | "Every day at 9:00 AM" |
| weekly, Mon to Fri | "Weekdays at 9:00 AM" |
| weekly, Sat and Sun | "Weekends at 10:00 AM" |
| weekly, all seven days | Same as daily |
| weekly, one day | "Mondays at 9:00 AM" |
| weekly, other sets | "Mon, Wed, and Fri at 9:00 AM" (Monday first) |
| zone differs from the list's `timezone` | Add the zone: "Every night at 3:00 AM New York time" (the IANA city, with spaces for underscores). For "UTC", add "UTC". |

Times use the browser locale (`Intl.DateTimeFormat`, `hour: "numeric",
minute: "2-digit"`).

### Times

Absolute times use the trigger's own zone. When that zone is not the
browser's zone, the zone name follows the time. Relative times count from now
and update once a minute. For a paused trigger, the next run if resumed now
comes from `nextOccurrence(schedule, Date.now())` in
`src/shared/triggerSchedules.ts`. The browser can import that module.

### Outcome words (`history[0]`)

| Outcome | Row line 3 |
| --- | --- |
| started, `cause: "schedule"` | "Started Oct 12, 3:00 AM" |
| started, `cause: "manual"` | "Started Oct 12, 2:41 PM by Run now" |
| failed | "Failed Oct 12: " and the first line of `error` |
| missed | "Missed Oct 12, 3:00 AM" |
| no history | "No runs yet" |
| local pending Run now | "Starting…" (live ring at the end of the strip) |

### Row menu (⋯, `MenuButton`-style, at window level)

In this order: the state action if there is one ("Mark as seen" or "Resume"),
"Run now…", "Pause" (active only), "Edit", separator, "Delete trigger…" (danger
tone). "Edit" opens the trigger's page and puts focus in the Name field.
"Run now…" and "Delete trigger…" open their dialogs (section 3).

### Many triggers (20 or more)

- At 9 or more triggers, a filter field appears above the groups (`.bl-filter`
  and `.bl-toolbar`). It matches name, project, and workflow. The total is a
  readout beside it, "23 triggers, 4 paused", and it goes under the field when
  the row is narrow, as `.bl-total` does.
- The groups collapse. The list scrolls inside `.settings-scroll`. A cut-off
  row at the bottom shows that more rows exist.
- There is no row cap. The groups already put problems at the top.

## 3. The trigger page, create, and edit

There is one page per trigger. It is a document that the user can edit, the
same pattern as the agent editor (`ui/src/ui/settings/AgentEditor.tsx`):
`SettingsFrame`, a title input, then `.agent-properties` fields. Create uses
the same page with no status and no runs.

### Header (`SettingsFrame`)

| Part | Trigger page | Create page |
| --- | --- | --- |
| Back | "Triggers" (`.settings-back`; below 26rem it shows only the chevron, as now) | "Triggers" |
| Title | The trigger's name | "New trigger" |
| Status | "Unsaved changes", "Saving…", "Saved" | "Creating…" |
| Primary (`.settings-primary`) | "Run now…" when the form has no changes. "Save" when it has changes. | "Create" |
| ⋯ "Trigger commands" | "Run now with saved settings…" (only with changes), "Pause" or "Resume", "Discard changes" (only with changes), "Copy trigger ID", separator, "Delete trigger…" | "Discard" |
| Close | "Close triggers" | "Close triggers" |

Ctrl or Cmd + S saves, as in the agent editor. If the user leaves the page
with unsaved changes, a `ConfirmDialog` (tone plain) asks first.

### Body, top to bottom

1. **Attention card** (only when `attention` is set). `AlertCard`, tone `bad`
   for failed and `warn` for missed. It describes the newest failed or missed
   run recorded since `attention.since`. The error text goes in its code block,
   in an `Excerpt` with 4 lines, or 2 lines when the body is short (see the
   plan). Actions: "Mark as seen" (POST `acknowledge`) and "Run now…". If more
   than one problem happened since `attention.since`, a line says how many.
2. **Name**: `.agent-name` input, placeholder "Name the trigger".
3. **Status lines** (readouts, `--small-text`):
   - Active: "Next run Tue, Oct 13 at 3:00 AM, in 9 hours." A "Pause" button
     at the end of the line.
   - Paused: "Paused since Oct 10. If you resume now, the next run is Tue,
     Oct 13 at 3:00 AM." A "Resume" button at the end of the line.
   - Last run: "Last run Oct 12 at 3:00 AM started a session." with an "Open
     session" button. Or "…failed." or "…was missed." or "No runs yet."
   This puts the most common morning action, opening last night's session, at
   the top of the page.
4. **Settings** (`.agent-properties`, `Field` rows; each label sits beside its
   value while the column has room and goes above it when it does not, as now):

| Label | Control | Notes |
| --- | --- | --- |
| Project | `DestinationPicker` (`ui/src/ui/DestinationPicker.tsx`), with `placement` not set so that no worktree choice shows | Hint: "Each run starts a new session in this folder." |
| Workflow | A chip that opens `OptionList` in a `FloatingPanel` at window level. It lists the project's saved workflows with name and description. A script workflow is shown but disabled, with the detail "Scripts cannot run on a schedule". | Needs contract gap 1. Hint from `definition.stages`: with a `land` stop, "Ends at a land stop, so each run waits for you to land it." Without one, "This workflow has no land stop. Its runs do not wait for your review." |
| Repeat | `ToggleGroup` (field): "Every day", "Some days" | |
| Days | Shown with "Some days" only. Seven pressed buttons, Mon to Sun, any number on. | New: a multiple-choice form of `ToggleGroup` (see components). The buttons wrap to a second line when the row is narrow. If all seven are on, the form saves `daily`. |
| Time | `<input type="time">`, value `HH:mm` | When the time is from 01:00 to 02:59, hint: "Clocks change at this hour on some nights. On those nights Forgerie runs once, at the nearest valid time." |
| Time zone | A chip that opens `OptionList` with search over `Intl.supportedValuesOf("timeZone")` plus "UTC" | The default is the list's `timezone`. When the chosen zone is not that zone, hint: "Forgerie's host uses America/Denver." |
| Model | `ModelPicker` with `emptyLabel: "Default for new sessions"`, models from `GET /api/models?cwd=` (`newSessionApi.models`), thinking levels from `thinkingLevelsFor` (`ui/src/newSession.ts`) | When a model is set, a text button "Use the default" clears it, like the agent editor's "Use the session's model". |
| Run late | `ToggleGroup` (field): "Never" (0), "1 hour" (60), "6 hours" (360, the default), "1 day" (1440). A value from the server that is not one of these is added as one more option, for example "90 min". | Hint, for example: "If Forgerie is off at 3:00 AM, the run starts when it is back, up to 6 hours late. After that, the run is recorded as missed." |

5. **Inputs** (`h2.agent-section` "Inputs", only when the workflow has
   inputs). Reuse `WorkflowInputFields` (`ui/src/workflows/WorkflowInputFields.tsx`)
   as it is, at full column width under the properties. It fits: it takes
   ordered inputs and text values. Fill it from saved inputs with
   `proposalInputs()`, and turn it back into typed inputs with
   `launchInputs()` (`ui/src/workflows/workflowsModel.ts`). A problem from
   `launchInputs` shows under the fields.
6. **Runs** (`h2.agent-section` "Runs" with the count and a run strip of up to
   14 marks). One `ActionRow` (`ui/src/ui/ActionRow.tsx`) per fire, newest
   first. The first 10 show, then "Show all 50" (`.picker-more`).

| ActionRow part | Content |
| --- | --- |
| name | Occurrence, "Tue, Oct 12, 3:00 AM" |
| status | "Started", "Failed" (`tone="danger"`), "Missed" |
| detail | Cause: "Scheduled" or "Run now". For failed, the error's first line (the whole error in its title). If `skippedBefore > 0`: "Also covers 2 earlier runs that passed while Forgerie was off." |
| actions | "Open session" for started. It calls the app's `switchSession({ id: sessionId, cwd })`, as Backlog's `onOpenSession` does. |

   Under the list, a quiet line (`.agent-group-where`): "Forgerie keeps the last
   50 runs."

### Create and save

- **ID.** `TriggerCreate.id` is required and is chosen by the client. The
  browser makes it from the name (`Nightly refinement` → `nightly-refinement`,
  shortened to 48 characters). On a 409 it tries again with `-2`, then `-3`, up
  to 5 times. The ID shows only in "Copy trigger ID". A rename does not change
  the ID (`TriggerUpdate` has no `id`).
- **Checks in the browser before the request**: a name, a project, a workflow,
  at least one day for "Some days", and input problems from `launchInputs`.
  Each problem shows under its field. A summary (`.agent-problems`) shows near
  the primary button. The primary button stays enabled. Pressing it moves
  focus to the first problem. A disabled button would not say why.
- **Server refusal (400 `{error}`)**: the page keeps every value and shows
  `SettingsFrame`'s `error` notice: "Forgerie did not save the trigger:
  <error>". If contract gap 6 adds a field key, the message also shows under
  that field.
- **After create**: replace the history entry with `?triggers=<id>` and show
  the toast "Created “Nightly refinement”. Next run Tue, Oct 13 at 3:00 AM."
- **Save** sends `PATCH` with only the changed fields. After the save, the status
  reads "Saved".
- **A `triggers.changed` event while there are unsaved changes** does not
  overwrite the fields. A notice (`SettingsFrame` `notice`) says: "This trigger
  changed while you were editing. Saving replaces those changes." See
  contract gap 8.

### Run now

`ConfirmDialog`, `tone="plain"`, from the header, a row menu, or the attention
card. Each fire costs one full workflow run, and there is no spend cap. A
second press is worth that cost.

- Title: "Run “Nightly refinement” now?"
- Body: "It starts refine-backlog in a new session of forgerie, as a scheduled
  run would. The next scheduled run stays Tue, Oct 13 at 3:00 AM." For a paused
  trigger, the last sentence is "The trigger stays paused."
- Confirm: "Run now". Busy: "Starting…"
- The browser makes `requestId` once per dialog and sends the same value again
  on a retry.
- On 202: toast "“Nightly refinement” is starting. Its session shows under
  Runs once it opens." The row and the page show a local "Starting…" mark until
  a history entry with `requestId` `trigger-<id>-run-<requestId>` arrives. This
  state is lost on reload (contract gap 3).

### Delete

`ConfirmDialog`, `tone="danger"`.

- Title: "Delete “Nightly refinement”?"
- Body: "It stops running, and its run history is deleted. The sessions it
  started stay in your session list."
- Confirm: "Delete trigger". Busy: "Deleting…"
- After delete: go to the list. Toast: "Deleted “Nightly refinement”."

## 4. States

| State | What shows |
| --- | --- |
| Loading, first read | List: three `.picker-skeleton` bars and the status "Reading triggers…". "New trigger" is enabled. If the list `timezone` is not known yet, the form takes the browser's zone and changes to the host's zone when the list arrives, unless the user already chose one. |
| Empty | `.bl-empty` layout: a `CalendarClockIcon`, "No triggers yet", one sentence, and a "New trigger" button. The header also has "New trigger". |
| Store unavailable (503) | `SettingsFrame` `error`: "Triggers are off: <error>. No trigger runs until sessiond can open its store. Check the sessiond log, then restart sessiond." Recovery: "Retry". The list body is empty. "New trigger" stays and fails with the same message. The footer chip shows "Off". |
| Other read failure | "Could not read triggers: <error>" and "Retry". If an older list is on screen, it stays under the notice. |
| Active | Time slot "in 9 h". Status line "Next run …". |
| Paused | Time slot "Paused". Name, schedule, and strip in `--faint-foreground`. "Resume" inline (wide tier) or first in ⋯. The page says when the next run would be. |
| Last fire failed | Bad square mark. Row line 3 "Failed Oct 12: <first line>". The page shows the attention card with the full error in an `Excerpt`. The Runs row has status "Failed". |
| Missed | Warn ring in the strip, warn square mark while attention is set. Line 3 "Missed Oct 12, 3:00 AM". Attention card: "Forgerie was not running at 3:00 AM and came back more than 6 hours later, so the run did not start late." |
| `skippedBefore > 0` | On the Runs row and in the attention card: "Also covers 2 earlier runs that passed while Forgerie was off." |
| Attention set | The row moves to "Needs a look". The footer count goes up. The user clears it with "Mark as seen" (row, row menu, or attention card). The row then moves back to its group. Opening the page, editing, or "Run now" does **not** clear it. It clears only when the user says so. |
| Unknown trigger (404) | Page title "Trigger". Notice: "No trigger has this ID. It may have been deleted." The Back button goes to the list. |
| Conflict (409) on pause, resume, run | Notice: "Could not pause “Nightly refinement”: <error>", and the same pattern for "resume" and "run". |
| Many (20 or more) | Filter field and total, groups collapse, the list scrolls (section 2). |

## 5. Layout across sizes

The layout depends only on the size of the containers. The inputs are the
width of `.settings-column` (container `settings`), the width of the header,
and the height of the scroll region. The constants are guesses until they are
measured in the real container.

```ts
const REM = 16;
const ROW_WIDE = 34 * REM;      // row: state action inline, 7 marks, meta on one line
const ROW_NARROW = 24 * REM;    // below: meta on two lines, 5 marks
const HEADER_TIGHT = 20 * REM;  // header below this: primary moves to the top of ⋯
const SHORT_BODY = 22 * REM;    // scroll region below this: error excerpt 2 lines, not 4

export function triggersPlan(column: number, header: number, body: number) {
  const row = column >= ROW_WIDE ? { tier: "wide", meta: "one line", marks: 7, stateAction: "inline" }
    : column >= ROW_NARROW ? { tier: "medium", meta: "one line; workflow truncates first, then project", marks: 7, stateAction: "menu" }
    : { tier: "narrow", meta: "schedule on one line; project and workflow on the next", marks: 5, stateAction: "menu" };
  return { row, primary: header >= HEADER_TIGHT ? "header" : "menu", errorLines: body < SHORT_BODY ? 2 : 4 };
}
```

The order in which things give way: spacing first (`--gutter` is already a
clamp), then readouts (the outcome text truncates, the workflow name, then the
project name, then strip marks over 5 become `+n`), then controls move to ⋯.
No control is removed. The ⋯ menus open at window level, so a narrow pane does
not clip them.

### The ladder, from running the plan

Container widths below come from running `triggersPlan` and `footerPlan` together with the shell rules
(`shellLayout`, picker `clamp(15rem, 22%, 18rem)` docked, `min(18rem, 100% −
3rem)` overlay, column `min(42rem, thread − 2 × gutter)`). They are derived,
not measured.

| Size (CSS px) | Shell | Column | Body | Row tier | Primary | Error lines | Footer tier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Desktop 1440 × 900 | docked | 672 | 852 | wide | header | 4 | middle |
| Desktop 1024 × 768 | docked | 672 | 720 | wide | header | 4 | middle |
| Fold unfolded landscape 932 × 553 | overlay | 672 | 505 | wide | header | 4 | middle |
| Fold unfolded portrait 704 × 783 | overlay | 667 | 735 | wide | header | 4 | middle |
| Fold folded landscape 711 × 374 (wide and short) | overlay | 672 | 326 | wide | header | 2 | middle |
| Fold cover screen (folded portrait) 475 × 638 | overlay | 443 | 590 | medium | header | 4 | middle |
| Narrow split pane 352 × 783 (half of unfolded) | overlay | 320 | 735 | narrow | header | 4 | middle |
| Tiny pane 280 × 600 | overlay | 248 | 552 | narrow | menu | 4 | icons |

Light and dark use the same layout. Only the token values change. Capture
every row of this table in both schemes (section 9).

### Wireframes

`[≡]` is the sheet opener. `( )` is the filled primary. `■` is a failed mark,
`○` is a missed mark, and `●` is a started mark.

**List, wide tier: Fold unfolded portrait 704 × 783 (the same at 932 × 553 and on desktop)**

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [≡] Triggers                                   ( New trigger )  [⋯]  [✕]  │
├───────────────────────────────────────────────────────────────────────────┤
│   Needs a look 1 ───────────────────────────────────────────────────────  │
│   ■  Nightly refinement                                          in 9 h   │
│      Every night at 3:00 AM   forgerie   refine-backlog                   │
│      ● ● ● ● ● ■ ■  Failed Oct 12: Workflow "refine-ba…  Mark as seen [⋯] │
│   Active 2 ─────────────────────────────────────────────────────────────  │
│      Weekday triage                                             in 15 h   │
│      Weekdays at 9:00 AM   pi-mono   triage-issues                        │
│      ● ● ● ● ● ● ●  Started Oct 12, 9:00 AM                          [⋯]  │
│      Release notes                                               in 4 d   │
│      Fridays at 5:00 PM   forgerie   release-notes                        │
│      No runs yet                                                     [⋯]  │
│   Paused 1 ─────────────────────────────────────────────────────────────  │
│      Docs sweep                                                  Paused   │
│      Sundays at 4:00 AM New York time   forgerie   docs-sweep             │
│      ● ○  Missed Oct 5, 4:00 AM                             Resume   [⋯]  │
└───────────────────────────────────────────────────────────────────────────┘
```

**List, wide tier on a short body: Fold folded landscape 711 × 374.** The
structure is the same. About four rows show, and the cut-off row shows that
the list scrolls. The header and its actions stay.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [≡] Triggers                                   ( New trigger )  [⋯]  [✕]  │
├───────────────────────────────────────────────────────────────────────────┤
│   Needs a look 1 ───────────────────────────────────────────────────────  │
│   ■  Nightly refinement                                          in 9 h   │
│      Every night at 3:00 AM   forgerie   refine-backlog                   │
│      ● ● ● ● ● ■ ■  Failed Oct 12: Workflow "refine-ba…  Mark as seen [⋯] │
│   Active 2 ─────────────────────────────────────────────────────────────  │
│      Weekday triage                                             in 15 h   │
│      Weekdays at 9:00 AM   pi-mono   triage-issues                        │
│      ● ● ● ● ● ● ●  Started Oct 12, 9:00 AM                          [⋯]  │
│      Release notes                                               in 4 d   │
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```

**List, medium tier: Fold cover screen 475 × 638.** "Mark as seen" moves to the
top of ⋯. The workflow name truncates first.

```
┌───────────────────────────────────────────────┐
│ [≡] Triggers          ( New trigger ) [⋯] [✕] │
├───────────────────────────────────────────────┤
│  Needs a look 1 ───────────────────────────── │
│  ■ Nightly refinement                 in 9 h  │
│    Every night at 3:00 AM  forgerie  refine-… │
│    ● ● ● ● ● ■ ■  Failed Oct 12: Workf…  [⋯]  │
│  Active 2 ─────────────────────────────────── │
│    Weekday triage                    in 15 h  │
│    Weekdays at 9:00 AM  pi-mono  triage-iss…  │
│    ● ● ● ● ● ● ●  Started Oct 12, 9:00…  [⋯]  │
└───────────────────────────────────────────────┘
```

**List, narrow tier: split pane 352 × 783.** The meta wraps to two lines and
the strip shows 5 marks. If a hidden mark failed, the `+n` count is in the bad
tone.

```
┌────────────────────────────────────┐
│ [≡] Triggers ( New trigger )[⋯][✕] │
├────────────────────────────────────┤
│ Needs a look 1 ─────────────────── │
│ ■ Nightly refinement        in 9 h │
│   Every night at 3:00 AM           │
│   forgerie   refine-backlog        │
│   ● ● ● ■ +3  Failed Oct 12…  [⋯]  │
│ Active 2 ───────────────────────── │
│   Weekday triage           in 15 h │
│   Weekdays at 9:00 AM              │
│   pi-mono   triage-issues          │
│   ● ● ● ● +3  Started Oct 1…  [⋯]  │
└────────────────────────────────────┘
```

**Tiny pane 280 wide.** The header is under 20rem, so "New trigger" moves to the
top of the header's ⋯ menu. The rows are the same as in the narrow tier.

```
┌──────────────────────────────┐
│ [≡] Triggers         [⋯] [✕] │   ⋯ → New trigger, Read triggers again
├──────────────────────────────┤
```

**Trigger page, wide tier: Fold unfolded landscape 932 × 553**

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [≡] ‹ Triggers │ Nightly refinement                       ( Run now… ) [⋯] [✕]   │
├──────────────────────────────────────────────────────────────────────────────────┤
│        ┃ Failed   The Oct 12, 3:00 AM run failed.                                │
│        ┃ ┌────────────────────────────────────────────────────────────────┐      │
│        ┃ │ Workflow "refine-backlog" was not found in /home/…/forgerie     │      │
│        ┃ └────────────────────────────────────────────────────────────────┘      │
│        ┃ Fix the cause, then run it now or wait for the next run.               │
│        ┃ Mark as seen     Run now…                                              │
│                                                                                  │
│        Nightly refinement                                                        │
│        Next run Tue, Oct 13 at 3:00 AM, in 9 hours.                     Pause    │
│        Last run Oct 12 at 3:00 AM failed.                                        │
│        ────────────────────────────────────────────────────────────────────      │
│        Project      forgerie ▾                                                   │
│                     Each run starts a new session in this folder.                │
│        Workflow     refine-backlog ▾                                             │
│                     Ends at a land stop, so each run waits for you to land it.   │
│        Repeat       [Every day] [Some days]                                      │
│        Time         [ 3:00 AM ]                                                  │
│        Time zone    America/Denver ▾                                             │
│        Model        Default for new sessions ▾                                   │
│        Run late     [Never] [1 hour] [6 hours] [1 day]                           │
│                     If Forgerie is off at 3:00 AM, the run starts when it is     │
│                     back, up to 6 hours late. After that, it is recorded as      │
│                     missed.                                                      │
│        ────────────────────────────────────────────────────────────────────      │
│        Inputs                                                                    │
│        Task                                                                      │
│        [ Refine the three oldest ready backlog items.                      ]     │
│                                                                                  │
│        Runs 12   ● ● ● ● ● ■ ■                                                   │
│        Tue, Oct 12, 3:00 AM   Failed    Scheduled. Workflow "refine-backl…       │
│        Mon, Oct 11, 3:00 AM   Failed    Scheduled. Workflow "refine-backl…       │
│        Sun, Oct 10, 3:00 AM   Started   Scheduled                Open session    │
│        Sat, Oct 9, 2:41 PM    Started   Run now                  Open session    │
│        Sat, Oct 9, 3:00 AM    Missed    Scheduled. Also covers 2 earlier runs…   │
│        Show all 12                                                               │
│        Forgerie keeps the last 50 runs.                                          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

When the form has unsaved changes, `( Run now… )` becomes `( Save )`, the
status reads "Unsaved changes", and "Run now with saved settings…" moves to the
top of ⋯.

**Trigger page, narrow tier: split pane 352 × 783.** Back shows only its
chevron. Labels go above their values. The day buttons wrap. Runs rows wrap
their detail and keep "Open session".

```
┌────────────────────────────────────┐
│ [≡] ‹ │ Nightly ref… (Run now…)[⋯][✕]│
├────────────────────────────────────┤
│ ┃ Failed  The Oct 12, 3:00 AM run  │
│ ┃ failed.                          │
│ ┃ ┌──────────────────────────────┐ │
│ ┃ │ Workflow "refine-backlog" was│ │
│ ┃ │ not found in /home/…/forgerie│ │
│ ┃ └──────────────────── Show more┘ │
│ ┃ Mark as seen   Run now…          │
│ Nightly refinement                 │
│ Next run Tue, Oct 13 at 3:00 AM,   │
│ in 9 hours.                 Pause  │
│ ────────────────────────────────── │
│ Project                            │
│ forgerie ▾                         │
│ Repeat                             │
│ [Every day] [Some days]            │
│ Days                               │
│ [Mon][Tue][Wed][Thu][Fri]          │
│ [Sat][Sun]                         │
│ …                                  │
│ Runs 12  ● ● ● ■ +3                │
│ Tue, Oct 12, 3:00 AM      Failed   │
│ Scheduled. Workflow "refine-b…     │
│ Sun, Oct 10, 3:00 AM     Started   │
│ Scheduled           Open session   │
└────────────────────────────────────┘
```

**Empty: Fold cover screen 475 × 638**

```
┌───────────────────────────────────────────────┐
│ [≡] Triggers          ( New trigger ) [⋯] [✕] │
├───────────────────────────────────────────────┤
│                                               │
│                     [@]                       │
│                No triggers yet                │
│    A trigger starts a saved workflow at a     │
│    set time, in a new session of a project.   │
│    In the morning, you review the work in     │
│    that session.                              │
│                ( New trigger )                │
└───────────────────────────────────────────────┘
```

**Store unavailable (503): any width**

```
┌───────────────────────────────────────────────┐
│ [≡] Triggers          ( New trigger ) [⋯] [✕] │
├───────────────────────────────────────────────┤
│ Triggers are off: <error>. No trigger runs    │  .notice role=alert
│ until sessiond can open its store. Check the  │
│ sessiond log, then restart sessiond.  [Retry] │
└───────────────────────────────────────────────┘
```

## 6. Copy

Sentence case everywhere. Actions keep the same name through the whole flow:
"Run now" → "Starting…"; "Delete trigger" → "Deleted"; "Mark as seen" has no
toast because the row moves.

### Entry and list

| Element | Text |
| --- | --- |
| Footer entry | "Triggers" |
| Footer title, attention | "Triggers: 1 needs a look" / "Triggers: 2 need a look" |
| Footer chip, store off | "Off"; title "Triggers are off" |
| Picker ⋯, moved item | "Full screen" / "Exit full screen" |
| Page title | "Triggers" |
| Primary | "New trigger" |
| Header ⋯ label | "Trigger commands"; item "Read triggers again" |
| Close | "Close triggers" |
| Groups | "Needs a look", "Active", "Paused" |
| Filter placeholder | "Filter by name, project, or workflow" |
| Filter, no match | "No triggers match “docs”." |
| Total | "23 triggers, 4 paused" |
| Time slot | "in 25 min", "in 9 h", "in 4 d", "due now", "Paused" |
| Inline and menu state actions | "Mark as seen", "Resume" |
| Row menu | "Run now…", "Pause", "Edit", "Delete trigger…" |
| Row menu label | "Commands for Nightly refinement" |
| Loading | "Reading triggers…" |
| Empty title | "No triggers yet" |
| Empty text | "A trigger starts a saved workflow at a set time, in a new session of a project. In the morning, you review the work in that session." |
| Store off | "Triggers are off: <error>. No trigger runs until sessiond can open its store. Check the sessiond log, then restart sessiond." |
| Read failure | "Could not read triggers: <error>" |
| Retry | "Retry" |

### Trigger page and form

| Element | Text |
| --- | --- |
| Back | "Triggers" |
| Create title | "New trigger" |
| Create lede (`.settings-lede`) | "A trigger starts a saved workflow at a set time, in a new session of the project. You review each run in its session." |
| Name placeholder / label | "Name the trigger" / "Trigger name" |
| Primary | "Run now…", "Save", "Saving…", "Create", "Creating…" |
| Status | "Unsaved changes", "Saved" |
| ⋯ items | "Run now with saved settings…", "Pause", "Resume", "Discard changes", "Copy trigger ID", "Delete trigger…" |
| Status, active | "Next run Tue, Oct 13 at 3:00 AM, in 9 hours." |
| Status, paused | "Paused since Oct 10. If you resume now, the next run is Tue, Oct 13 at 3:00 AM." |
| Status, last run | "Last run Oct 12 at 3:00 AM started a session." / "…failed." / "…was missed." / "No runs yet." |
| Status buttons | "Pause", "Resume", "Open session" |
| Field labels | "Project", "Workflow", "Repeat", "Days", "Time", "Time zone", "Model", "Run late" |
| Project hint | "Each run starts a new session in this folder." |
| Workflow empty chip | "Choose a workflow" |
| Workflow search | "Find a workflow" |
| No workflows in project | "This project has no saved workflows. Add one in Settings, under Skills and prompts." |
| Script workflow detail | "Scripts cannot run on a schedule" |
| Workflow hint, land stop | "Ends at a land stop, so each run waits for you to land it." |
| Workflow hint, no land stop | "This workflow has no land stop. Its runs do not wait for your review." |
| Repeat options | "Every day", "Some days" |
| Day buttons | "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" |
| Time hint, 01:00–02:59 | "Clocks change at this hour on some nights. On those nights Forgerie runs once, at the nearest valid time." |
| Time zone search | "Find a time zone" |
| Time zone hint | "Forgerie's host uses America/Denver." |
| Model empty | "Default for new sessions" |
| Model clear | "Use the default" |
| Run late options | "Never", "1 hour", "6 hours", "1 day" |
| Run late hint | "If Forgerie is off at 3:00 AM, the run starts when it is back, up to 6 hours late. After that, the run is recorded as missed." For "Never": "If Forgerie is off at 3:00 AM, the run is recorded as missed." |
| Section headings | "Inputs", "Runs" |
| Problems | "Give the trigger a name." / "Choose a project." / "Choose a workflow." / "Choose at least one day." / the problem text from `launchInputs` |
| Server refusal | "Forgerie did not save the trigger: <error>" |
| ID collision after 5 tries | "Another trigger already uses this name. Change the name and try again." |
| Edited elsewhere | "This trigger changed while you were editing. Saving replaces those changes." |
| Leave with changes (dialog) | Title "Discard your changes?"; body "Your changes to “Nightly refinement” are not saved."; confirm "Discard changes"; cancel "Keep editing" |
| Unknown trigger | "No trigger has this ID. It may have been deleted." |
| Pause or resume failure | "Could not pause “Nightly refinement”: <error>" / "Could not resume “Nightly refinement”: <error>" |
| Created toast | "Created “Nightly refinement”. Next run Tue, Oct 13 at 3:00 AM." |
| Copied (live region) | "Trigger ID copied" |

### Attention card

| Element | Failed | Missed |
| --- | --- | --- |
| `label` (accessible) | "Run failed" | "Run missed" |
| `subject` | "Failed" | "Missed" |
| `title` | "The Oct 12, 3:00 AM run failed." | "The Oct 12, 3:00 AM run was missed." |
| Body | "Fix the cause, then run it now or wait for the next run." | "Forgerie was not running at 3:00 AM and came back more than 6 hours later, so the run did not start late." |
| More problems | "2 runs had problems since Oct 11." | same |
| Skipped | "Also covers 2 earlier runs that passed while Forgerie was off." | same |
| `code` | The `error` text | none |
| Actions | "Mark as seen", "Run now…" | "Mark as seen", "Run now…" |

### Runs

| Element | Text |
| --- | --- |
| Status | "Started", "Failed", "Missed", "Starting…" |
| Cause | "Scheduled", "Run now" |
| Action | "Open session" |
| More / fewer | "Show all 50" / "Show fewer" |
| Empty, active | "No runs yet. The first run is Tue, Oct 13 at 3:00 AM." |
| Empty, paused | "No runs yet." |
| Foot | "Forgerie keeps the last 50 runs." |

### Dialogs and toasts

| Element | Text |
| --- | --- |
| Run now title | "Run “Nightly refinement” now?" |
| Run now body | "It starts refine-backlog in a new session of forgerie, as a scheduled run would. The next scheduled run stays Tue, Oct 13 at 3:00 AM." (paused: "…as a scheduled run would. The trigger stays paused.") |
| Run now buttons | "Run now" / "Starting…" / "Cancel" |
| Run now toast | "“Nightly refinement” is starting. Its session shows under Runs once it opens." |
| Run now failure | "Could not run “Nightly refinement”: <error>" |
| Delete title | "Delete “Nightly refinement”?" |
| Delete body | "It stops running, and its run history is deleted. The sessions it started stay in your session list." |
| Delete buttons | "Delete trigger" / "Deleting…" / "Cancel" |
| Delete toast | "Deleted “Nightly refinement”." |
| Delete failure | "Could not delete “Nightly refinement”: <error>" |

## 7. Components and files

| Need | Reuse | Path |
| --- | --- | --- |
| Page frame, header, notices | `SettingsFrame` | `ui/src/ui/settings/SettingsFrame.tsx` |
| List layout, filter, groups, empty | Backlog classes `.bl-column`, `.bl-toolbar`, `.bl-filter`, `.bl-total`, `.bl-row`, `.bl-empty`; `.picker-group-header`, `.picker-more`, `.picker-skeleton` | `ui/src/ui/backlog/backlog.css`, `ui/src/ui/theme.css` |
| Header menus | `.settings-menu-anchor` with `.picker-menu`, or `MenuButton` | `ui/src/ui/settings/settings.css`, `ui/src/ui/MenuButton.tsx` |
| Form fields | `.agent-name`, `.agent-properties`, `.agent-field`, `.agent-section`, `.agent-problems` | `ui/src/ui/settings/settings.css` |
| Project | `DestinationPicker` | `ui/src/ui/DestinationPicker.tsx` |
| Workflow, time zone | `OptionList` in `FloatingPanel`, placed with `usePanelPlacement` | `ui/src/ui/OptionList.tsx`, `ui/src/ui/FloatingPanel.tsx` |
| Model | `ModelPicker` with `emptyLabel`; `thinkingLevelsFor`; `newSessionApi.models` | `ui/src/ui/ModelPicker.tsx`, `ui/src/newSession.ts` |
| Inputs | `WorkflowInputFields`, `launchInputs`, `proposalInputs` | `ui/src/workflows/WorkflowInputFields.tsx`, `ui/src/workflows/workflowsModel.ts` |
| Repeat, Run late | `ToggleGroup` (`field`) | `ui/src/ui/ToggleGroup.tsx` |
| Days | **New**: a form of `ToggleGroup` where any number of options can be on. Add it to `ui/src/ui/` with its part and a README line, as `ui/src/ui/README.md` asks. | `ui/src/ui/` |
| Attention card | `AlertCard`, `Excerpt` | `ui/src/ui/AlertCard.tsx`, `ui/src/ui/Excerpt.tsx` |
| Runs rows | `ActionRow` | `ui/src/ui/ActionRow.tsx` |
| Run strip | `visibleMarks()` and the `.tally-mark` drawing | `ui/src/ui/TallyRow.tsx`, `ui/src/ui/TallyRow.css` |
| Dialogs | `ConfirmDialog` (`plain` for Run now and leave, `danger` for Delete) | `ui/src/ui/ConfirmDialog.tsx` |
| Toasts | `Toast` in the page's `ToastRegion` | `ui/src/ui/Toast.tsx` |
| Footer entry | `.picker-footer`, `.picker-new`, `.picker-footer-count` (add `data-tone`) | `ui/src/ui/Picker.tsx`, `ui/src/ui/theme.css` |

New modules, with the backlog as the model: `ui/src/triggers/triggersApi.ts`,
`ui/src/triggers/useTriggerList.ts`, `ui/src/triggers/triggersModel.ts`
(groups, order, `triggersPlan`, `footerPlan`, place parsing),
`ui/src/triggers/triggerWords.ts` (schedule, time, and outcome words, all pure
and unit-tested at every boundary), and `ui/src/ui/triggers/TriggersView.tsx`
with `triggers.css`, loaded lazily as `BacklogView` is. The browser imports
types only from `src/shared/triggers.ts` and `src/shared/triggerSchedules.ts`.

## 8. Contract gaps

| # | Gap | Why the screen needs it | Recommendation |
| --- | --- | --- | --- |
| 1 | **No way to list a project's workflows without a session.** The only route is `GET /sessions/:id/workflows?cwd=`, and `PiSessionService.workflowInventory` calls `getOrOpen(ref)` first (verified in `src/server/sessions/piSessionService.ts:2539`). | The create form must list workflows for the chosen project before any session exists. | Add `GET /triggers/workflows?cwd=` that returns the `WorkflowLibrary.list(cwd)` inventory. **This blocks the form.** |
| 2 | The inventory does not say whether a workflow is prose or a script. A script fails only at run time (`workflowLibrary.ts:105`). | The form must not offer a workflow that the server will refuse. | Add `kind: "prose" \| "script"` to each inventory entry. |
| 3 | **Run now has no pending state.** The 202 response has only `requestId`. `Trigger` has no record of a fire in progress. | Without it, the browser cannot show "Starting…" after a reload, or link the session before the fire is recorded. | Add `pending: { requestId, cause, occurrence, since }[]` to `Trigger`, or return `{ requestId, sessionId, cwd }` from the 202 (the server knows the session ID it will use). |
| 4 | A `failed` outcome has no `sessionId` or `cwd`, even when the session exists. The contract says the failure is written into that session. | The user should be able to open the session that holds the failure message. | Add optional `sessionId` and `cwd` to `failed`. |
| 5 | The contract does not say how much `history` `GET /triggers` returns. It says that `GET /triggers/:id` returns up to 50. | The row needs `history[0]` and the last 7 runs. The attention card needs every problem since `attention.since`. | State it: the list returns at least the last 7 runs (all 50 is fine: 20 × 50 small records). |
| 6 | A 400 error is one string with no field. | A refusal should show under the field it is about. | Add an optional `field` to the error: `"name" \| "schedule" \| "action.cwd" \| "action.workflow" \| "action.inputs" \| "action.model" \| "missedGraceMinutes"`. |
| 7 | Nothing says who created a trigger. The agent tool creates triggers without asking (open decision 1). | A trigger that the user did not make can appear and cost a run each night. | Add `origin: { kind: "browser" } \| { kind: "agent", sessionId, cwd }`. Show it on the trigger page: "Created by an agent in <session name>", with "Open session". |
| 8 | `PATCH` has no version check. The agent tool can change the same trigger. | A save can overwrite a change made by an agent without a warning. | Accept an optional `generation` on `PATCH`. Return 409 when it is not the current one. |
| 9 | Create needs an `id` chosen by the client. | The user never needs to see an ID. | Keep it, and the browser derives the ID (section 3). Or make `id` optional and have the server derive it from the name. |
| 10 | Time zones are checked against the host's ICU data. The browser lists its own (`Intl.supportedValuesOf`). | A zone the browser offers may be refused. | Accept this. The 400 message shows. A zone list from the server is not worth a route now. |

## 9. Open questions

Each one has a recommendation and its cost.

| # | Question | Options | Recommendation | Cost |
| --- | --- | --- | --- | --- |
| 1 | How does the footer make room for Triggers? | A: Full screen into the picker ⋯ menu, Settings icon-only (the footer plan). B: Triggers icon-only beside Full screen. C: A second footer row. | **A.** The two places that are visited by name (Backlog, Triggers) keep their words. The gear is the most widely known icon. | Full screen needs 2 taps instead of 1. Settings loses its word in the footer. C would take 48px from the session list at every size. |
| 2 | Does trigger attention also show on the sheet opener's dot (`AppShell` `attention`) when the session list is closed? | Yes, at the "blocked" level. Yes, at the "unread" level. No. | **Yes, at "blocked"**, and only when no session already sets the dot. On the Fold the list is closed whenever a session is open, so without this a failed night shows nowhere until the user opens the list. | The dot no longer means only sessions. The user opens the list and must find the footer chip. |
| 3 | Does Run now ask first? | Confirm dialog. One press with an undo toast. | **Confirm dialog.** Each run costs a full workflow run and there is no spend cap. The 202 starts a durable task, so an undo cannot stop it. | One more tap for each manual run. |
| 4 | Does any action other than "Mark as seen" clear attention? | Explicit only. Also when the user opens the trigger page. Also on Run now. | **Explicit only.** Opening the page is not the same as dealing with the problem, and the count must stay true. | The user taps once more after fixing a problem. |
| 5 | Contract open decision 1: the agent tool creates triggers without asking. | As written. The tool proposes a card and the user confirms. | **Proposal card** (opinion). Forgerie already has this pattern (`WorkflowProposalCard`), and each trigger costs a full run every night. If the decision stays "as written", gap 7 becomes required. | More server work. The agent cannot set up a trigger when the user is away. |
| 6 | Contract open decision 2: a missed run is recorded, not run late. | As written, with the grace. Always run late. | **As written.** The screen shows the grace as the "Run late" field, so the user can choose "1 day". | A missed run needs Run now by hand. |
| 7 | Contract open decision 3: delete removes the history. | As written. Keep a tombstone. | **As written.** The sessions stay and are where the work is. The delete dialog says this. | After a delete, the user cannot tell from Forgerie which trigger started an old session, other than its name. |
| 8 | Is the label "Triggers" or "Schedules"? | Triggers. Schedules. | **Triggers.** It matches `docs/triggers.md`, the contract, and how the user names it. The empty state says what a trigger does. | It is a less plain word than "Schedules" for a new user. |
| 9 | Which postures prove the layout? The task names the cover screen, unfolded portrait, unfolded landscape, and a narrow split pane. `docs/testing.md` and `scripts/lib/fold8-postures.mjs` define folded landscape (711 × 374), not a split pane. | Task set. Repository set. Both. | **Both: five sizes × two schemes.** Use 475 × 638, 704 × 783, 932 × 553, 711 × 374, and a split pane of 352 × 783. 711 × 374 is the only wide and short case. | Two more captures for each page. |

## 10. Outside the question

| Item | Importance |
| --- | --- |
| In the session list, nothing but the name ("Nightly refinement · Oct 13") marks a session that a trigger started. A small mark, like the backlog's `.picker-from-backlog`, would help in the morning. Not part of this slice. | Low |
| The count goes stale unless `catalogStore.ts` forwards `triggers.changed`. Today it drops event types it does not know. | Medium |
| The footer is already near its limit at a 15rem picker: Backlog's count chip may truncate today. This is my estimate, not a measurement. The footer plan makes it explicit. | Low |
| A browser in a different zone from the host: the screen shows each trigger's times in that trigger's zone and names the zone. The form's default is the host's zone, not the browser's. The user in Denver will not see a difference. | Low |

## 11. Proof the builder owes

- Unit tests for `triggersPlan` and `footerPlan` one pixel on each side of every
  threshold. Tests for `scheduleWords` at 04:59, 05:00, 20:59, and 21:00, for
  each weekday set, and for a zone that differs. Tests for group and order
  rules, and for a fire's `requestId` matching a pending Run now.
- Captures with `node scripts/capture-postures.mjs` at the five sizes in open
  question 9, in light and dark: the list with a failed, a missed, an active,
  and a paused trigger; the list with 23 triggers; empty; 503; the trigger page
  with attention; the create page with a validation problem; the Run now and
  Delete dialogs; and the session list footer. Look at every PNG. Check for a
  split group, a readout that kept its width while a control was squeezed, a
  fixed gap while a row was lost, and a menu that the pane clips.

## The one thing that must not be lost

On a good night, this screen is not part of the morning. The user goes from
the session list to the land card. The screen is quiet until a night fails to
make a session. Then the footer count, the "Needs a look" group, and the
attention card make sure the user sees it, and the user decides when it is
dealt with. At every size the primary action stays in the header or in its ⋯
menu.
