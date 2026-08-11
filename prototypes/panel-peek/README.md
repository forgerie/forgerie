# Panel peek — design record

How side panels appear, who decides, and what a gesture is allowed to change.
No sketches yet; this is the model the sketches will have to satisfy.

Borrowed from Obsidian on Android: a horizontal drag anywhere in the content
area pulls a side sheet in, tracking the finger, so a peek can be aborted at
zero cost.

## The rule

**Space owns presentation. The user owns intent. A peek never writes intent.**

Nothing recomputes a stored user choice because the window got narrower. A
swipe, a fold, a rotate, and a resize all change what you see and none of them
change what you asked for.

## The model

```
presentation = f(intent, capacity, availability)
```

| Input | Source | Lifetime | Example |
|---|---|---|---|
| `PanelIntent` | user only, by explicit act | durable, global | `Auto` \| `Pinned` \| `Dismissed` |
| `capacity` | available inline size vs content minimums | recomputed continuously | single- / two- / three-surface |
| `availability` | the selected session's content | per session | no workspace → nothing to show |

**Built:** intent and capacity, in `src/client/src/appShell/panelIntent.ts` and
`panelIntentController.ts`. Seating is a fit rather than the table below:
pinned panels are seated before never-touched ones, cheapest first, while the
session keeps a readable measure. The table is what that fit produces.

**Not built:** `availability`. Nothing varies it today — the workspace panel
shows a useful empty state when no workspace is selected, so it is honestly
available — and a parameter no caller varies is a guess about the future.
Add it when a panel genuinely has nothing to show. The captured
`folded-portrait-workspace.png` shows the cost plainly: peeking the workspace
panel with no workspace selected spends a full sheet on "Select a project".

### Promotion, as built

The pin sits alone in a slim band at the top of the sheet. It carries no title:
the panel underneath already names itself, and a sheet reading "Sessions" over
a panel reading "Inbox" is two vocabularies for one concept. It is the only
route from a look to a decision — a regression test asserts that dragging a
sheet fully open leaves the stored intent at `auto`.

`PanelPresentation` is `Docked` \| `Peeked(progress)` \| `Hidden`, derived, never
stored. `Peeked` carries a 0–1 progress because the finger drives it; it is
discarded on dismiss, navigation, and reload.

Capacity thresholds are the content minimums already in
`src/client/src/appShell/shellLayoutMode.ts` — navigation 260, transcript 560,
workspace 360 — not device classes.

**Availability is not intent.** A panel that yields because it has nothing to
show must not read back as "the user dismissed it".

## Intent × capacity

| Intent | single-surface | two-surface | three-surface |
|---|---|---|---|
| `Auto` | Hidden | inbox `Docked` | both `Docked` |
| `Pinned` | Hidden | `Docked` | `Docked` |
| `Dismissed` | Hidden | Hidden | Hidden |

Read the first column: on a phone, intent is inert. There is only the
transcript and the peek gesture. Nothing persisted can surprise you on the
narrowest surface. Intent is dormant there, not absent — it is read the moment
the device unfolds, rotates, or opens on a desktop.

### Decisions taken

| Question | Answer | Rejected |
|---|---|---|
| Scope of intent | **Global.** One key per panel | Per project — the inbox is machine-scoped by invariant (`GlobalSessionsState`), so layout would flip on every cross-project hop. Per capacity band — device-class state in an intrinsic costume |
| `Pinned` where only one surface fits | **Degrade to `Auto`** | "This is my home surface" — one word, two meanings, the exact paradigm flip the intrinsic rule exists to prevent |
| Two pinned panels, one dockable slot | **Pinned is just pinned.** Panels dock in content-minimum order until space runs out; the one that cannot fit stays peekable and re-docks when space returns | Fixed arbitrary priority; most-recently-pinned (needs a stored timestamp driving layout) |
| Horizontal drag already means "archive" on inbox rows | **The sheet wins.** Row actions move to a long-press menu | Row-wins (two gesture vocabularies in one surface); direction split (left archives, right peeks — indistinguishable mid-drag) |
| Where intent is stored | **`localStorage`, per browser.** It is the only client persistence this app has | A server-side per-user store — no such seam exists, and intent is inert on a phone anyway, so the split costs nothing today |

## Control surface

One pin toggle. Three internal states, because "never touched" is not
"explicitly off".

| State | Reached by | Behaviour |
|---|---|---|
| `Auto` | never touched | capacity decides |
| `Pinned` | pin | docked whenever it physically fits |
| `Dismissed` | unpin | never docked; peek only |

The pin renders only where it does something — two-surface capacity and up. A
pushpin on a phone that changes nothing visible is a lie. Cost: a phone-only
user cannot express a layout preference, which is consistent, because they have
no layout to express one about.

Only these write intent: the pin control inside a peeked sheet, unpinning a
docked panel, and reset-to-auto. Explicitly **not** writing intent: swiping,
opening or closing a peek, resizing, folding, rotating. No "you did this three
times so I made it permanent" — silent inference is the fight this model exists
to avoid.

## Two verbs, and only two

| Verb | Scope | Means | Desktop twin |
|---|---|---|---|
| horizontal drag | shell-level, everywhere | reveal / dismiss a panel | trackpad `deltaX`, edge control, shortcut |
| long-press | surface-local, on an item | act on this item | right-click |

One meaning each, no exceptions. A gesture that means two things depending on
where the finger landed is the failure this whole model is built to avoid.

Because long-press is surface-local, it stays text selection in the transcript
(whose items *are* text) and becomes the row menu in a list. No contradiction —
the surface owns the noun, the verb is constant.

## The gesture

What makes swipe-anywhere safe is not that it is anywhere; it is that it is
**drag-tracked**. The sheet follows the finger, so a 15% peek can be abandoned
for free. Ship that property first. A tap-toggle bound to a whole-surface
gesture has the blast radius with none of the reversibility.

**Built**, in `panelPeek.ts` (the arithmetic) and `panelPeekController.ts` (the
events). The sheet drops its CSS transition while a finger is down, because
easing makes the sheet lag the hand and the peek stops feeling direct.

| Number | Value | Why |
|---|---|---|
| capture distance | 10px | short, so the sheet follows early and reads responsive |
| angle gate | 30° | a thumb travels in an arc, not a line |
| commit share | 0.4 | past this, letting go opens |
| rest window | 400ms | a still finger is selecting text or holding a row |
| wheel settle | 120ms | a trackpad sends travel in pieces and never releases |

**All five are estimates.** They are numbers on glass. None of them is right
until a hand on the acceptance device says so.

The same pipeline serves the desktop: a trackpad two-finger horizontal `wheel`
with `deltaX` is the same drag and earns the same rubber-band peek. The
keyboard shortcut and `AppPanelEdgeControl` are other ways to say the same
three words — `reveal`, `dismiss`, `pin`. One intent vocabulary, four input
devices, no device sniffing.

Conflict rules, because the transcript is full of horizontal scrollers:

1. The drag must be within ~30° of horizontal and pass ~10px before it captures.
2. A drag starting on a horizontally scrollable descendant belongs to that
   element. Reaching its scroll end does **not** chain into the sheet; a fresh
   gesture is required.
3. Long-press first is text selection; the gesture is disarmed for that pointer.

## Known collisions

| Where | What |
|---|---|
| `SessionInboxPanel.ts` | **Resolved.** Swipe-to-archive is gone; a hold (or right-click) opens the row's commands. The `E` shortcut and the undo toast are unaffected. The menu holds only what the server can actually do — there is no rename or fork endpoint, so those were not invented |
| `PanelCollapseController.ts` | **Resolved.** Replaced by `PanelIntentController` |
| `shared.ts`, `PiWebApp.ts`, `AppMobileMainTabs.ts`, `AppPanelEdgeControl.ts`, `SettingsPanelFrame.ts`, `TerminalPanel.ts`, `SessionTreeNavigator.ts` | Viewport breakpoints at 1180/1181 and 760 survive from the fork point. Both sit inside or beside the 499–979 posture range. `shellLayoutMode.ts` has the right model; these components have not migrated to it. Seamlessness does not arrive until they do |
