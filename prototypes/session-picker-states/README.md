# Session picker: state sheet

Throwaway prototype. It answers one question: what does the machine-agnostic
session picker look like in every state, in the visual language of the new
assistant-ui client (`.worktree/new-ui-mvp`)? It is not production code.

Open `index.html` in a browser. No build, no server. Or capture the Fold 8
posture matrix:

```bash
node scripts/capture-postures.mjs --url file://$PWD/prototypes/session-picker-states/index.html \
  --out /tmp/picker-shots --label picker --color-scheme dark
```

## Brief

- Subject: the hub of a control surface for coding-agent sessions. One user,
  many sessions, on a Fold 8 and on a desktop.
- Job: get to the session that needs you, and start a new one. Nothing else
  comes first.
- Constraint from the user: no machine chooser. Sessions from every machine
  sit in one list. The machine is a fact about a session, like its project.
- Constraint from the inventory (`docs/briefs/2026-09-29-session-picker-responsibilities.md`):
  keep every capability. The sheet ends with a coverage table.

## Design plan

Tokens come from `theme.css` in the new client. Nothing new is added except
one pale attention tint for the machine notice.

- Color. The thread already gives two hues a meaning: `--live` blue means
  running, `--destructive` red means failed. The picker uses the same two and
  nothing else. Blocked is not a third color. It is weight: a filled square
  marker and a 600 title. Unread is a dot. Open is quiet.
- Type. Public Sans for titles, headers, and menus. JetBrains Mono for times
  and counts.
- Layout. One row is: marker, title, time on the first line; location and
  live-work counts on the second. Below 320 px the grouping control moves
  into the overflow menu. Thresholds are guesses until measured on the
  device.
- State lives in three places only: the group heading, the marker, and the
  time column. Rows carry no status words.
- Time is always shorthand (`<1m`, `41m`, `2h`, `3d`, `1w`), never a clock
  (user, 2026-09-29). An idle row shows how long since it last changed. A
  working row shows, in blue, how long the current run has lasted.

Things the plan rejects on purpose: state badges in five colors (the old
client), avatars and initials (chat apps), ALL CAPS group labels, and
per-row hover-only buttons (unreachable on touch).

## Mobbin references

- [Plain, My threads](https://mobbin.com/screens/b83cf467-b501-4c8f-b28c-e638a48d8a51):
  a triage inbox where the status of the thread, not its folder, is the
  first-level grouping, with counts on each state. The picker adopts this.
- [Claude, sidebar](https://mobbin.com/screens/9a78871e-afe7-4464-b320-a395202a739a):
  Starred above Recents, plain text rows, one New chat action. The picker
  adopts pinned-first and the single primary action, and rejects the absence
  of state because agent sessions have state.
- [Klaviyo Helpdesk](https://mobbin.com/screens/d7325318-22e7-4dbb-a460-f579eaad2b7e)
  and [Featurebase inbox](https://mobbin.com/screens/e0f32f22-8478-4ca8-b700-d4a74aacefad):
  a filter rail beside the list. Rejected. The rail costs 120 to 180 px and
  this picker has to live in a 260 px column.
- [Telegram web](https://mobbin.com/screens/a90e7b59-3143-45fc-bb7c-dfccce452e62):
  an unread row is a bold title and a dot, not a color. Adopted.
- [Mindtrip](https://mobbin.com/screens/229e6194-657c-4e86-9e6b-70dfd92ab4ed):
  a search field at the top of the history. Not adopted now. The inventory
  found no search today. It is listed as an open question.

## Decisions proposed in the sheet

Each one is a proposal for review, not a done deal.

1. Machine as location. A session row shows `machine / project · branch`
   only when more than one machine is configured. With one machine the
   machine name never appears.
2. Unreachable machine. Its sessions stay in the list from the last snapshot,
   dimmed, under one notice line. No machine chooser and no per-machine tab.
3. Archive of a running session. The server refuses this
   (`piSessionService.ts:3090`). The menu therefore shows "Archive" disabled
   with the reason "Stop the run first" instead of the old confirm dialog
   that could not succeed.
4. Row commands. Long press, right click, the Menu key, and a visible "⋯"
   on the selected or focused row. No hover-only controls.
5. Add machine, remove machine, and clean up sessions live in the actions
   palette, reached from the picker's "⋯" menu. They are not picker rows.

## Rules from review

- No chat text in the picker (user, 2026-09-29). A row never shows the ask
  question, an extension dialog's title, an error message, or the first
  message. A session with no name shows "Untitled session". This replaces
  inventory item 4.1 (title falls back to the first message).
- No status words in the picker (user, 2026-09-29). The second line holds
  only the location and the live-work counts. `needs your answer`,
  `needs your decision`, `failed`, `working`, `compacting context`,
  `running a command`, and `starting` are gone. This replaces inventory item
  4.3 (detail line). What is lost: the picker no longer tells an ask from an
  extension dialog, or compacting and running a command from plain
  streaming. Both remain visible inside the thread.

## Open questions

- Search: none exists today. Add one, or leave it out of the MVP?
- Density setting: keep the comfortable/compact choice, or fix one height?
- Age bands: keep six, or fewer?
