---
date: 2026-08-14
topic: radial-summon-menu
artifact: brief
---

# Radial Summon Menu

## Chosen Thing

Summon any panel with a long press anywhere on the conversation, which opens a
full-circle radial menu centred on the finger. Eight wedges at 45 degrees hold
seven panels plus an overflow. A wedge's direction is fixed and never moves.

Replaces nothing. It sits alongside the existing drag-to-peek gesture and the
panel openers, and it shares their timing: the peek controller's still-timer
gives up at `ROW_PRESS.holdMs`, and the wheel arms at exactly that moment.

## Users and Context

For a Forgerie user holding a tablet in one hand, working with one thumb. The
workspace panel tab strip sits at the top of its panel, which is the least
reachable part of a 14.6-inch screen in that grip, and the inbox lives on the
opposite edge from the other panels.

## Why Radial

Four other arrangements were built and compared as throwaway prototypes: an
icon arc, a labelled arc, a vertical list beside the thumb, and a stir-to-scrub
knob. Radial was chosen for one property none of the others can offer.

Every arrangement that is not a full circle has to rotate to stay on screen
near an edge. A rotating arrangement can only promise an *order* — "the first
one going up" — because its angles change with the press point. A full circle
has no direction it can rotate to, so a slot's bearing is identical on every
press, in every posture. That makes the gesture learnable by hand rather than
by reading, and the learning is available immediately rather than after weeks.

A second, measured reason: at the eight slots the panel set actually needs,
three of the four alternatives cannot open at all on the cover screen in
landscape (711 × 374). The arc variants run out of arc; the list runs out of
height. Radial and the knob were the only two that fit.

## Slot Map

Order follows the panels' own `order` values rather than taste. Agents sits
behind overflow because `plugins/core/panels.ts` describes it as the
least-reached-for tool.

| Slot | Panel |
|---|---|
| W | Inbox |
| NW | Files |
| N | Git |
| NE | Terminal |
| E | first unassigned panel, locked on first run |
| SE | second unassigned panel, locked on first run |
| S | Notifications |
| SW | More — everything else, via the workspace sheet |

Most-used sits in the upper half deliberately. The lower wedges point toward
the palm, and they are also the half that clips when the thumb is near the
bottom corner, so the least-used items absorb both costs.

## Goals

- A slot's direction is constant across presses, postures, and sessions.
- Selection is by bearing alone, so a wedge that clipped off screen is still
  reachable by flicking toward where it has always been.
- Installing or removing a plugin never moves an existing direction.
- A conditionally hidden panel keeps its slot rather than letting the wheel
  close up around it.
- The half-second hold is visible while it is happening.

## Non-Goals

- Replacing the drag-to-peek gesture or the panel openers.
- A configurable wedge count. Changing the count moves every direction.
- User-reorderable slots, for the same reason.
- Left-hand mirroring as a toggle. It flips W to E and rotates all eight, so it
  can only ever be a one-time setup choice.
- Nested wheels. Overflow opens the workspace sheet, whose tab strip already
  lists every panel.

## Load-Bearing Decision: The Slot Map Is Stored, Not Derived

`PluginRegistry.workspacePanelContributions` sorts by `order ?? 1000` then
title. A wheel that read that list directly would silently re-teach every
direction on plugin install: a panel arriving at `order: 15` would insert
between Files (10) and Git (20) and rotate everything after it.

So `appShell/radialSlots.ts` keeps its own assignment in `localStorage`, grows
only into free slots, and leaves a hole when a panel disappears. The assignment
is derived exactly once, on first run, and frozen after that.

This is cheap now and impossible to retrofit once people have learned the
directions.

## Measured Costs

Radial refuses to move its centre, because every bearing is taken from the
finger and moving the centre would change all of them at once. Clipping near an
edge is therefore a permanent property, not a defect. Measured across 274,205
press points in the prototype:

- Roughly one thumb-zone press in four hides at least one icon.
- A hard corner press can show as little as one icon of eight.
- Wedge count is almost free: coverage is the same at 4, 8, and 12 wedges,
  because it depends on whether the wheel fits at all rather than on how finely
  it is divided.

Selection still works in those cases, so **clipping is a learning cost, not an
operating cost**. That is only true while learning can happen somewhere else,
which is why the panel openers stay.

Three adjustments are deliberately refused, each because it would trade away
the premise: moving the centre changes every bearing; sliding an icon sideways
points it at a wedge it is not; pushing an icon into the hub makes it read as a
mistake. The only legal adjustment is walking an icon inward along its own ray,
and when that runs out the icon is dropped rather than drawn wrong.

## Known Gap

There is no keyboard path and no ARIA exposure for the wheel; it is
`aria-hidden` and touch-only. Panels remain reachable by every existing route —
the openers, the tab strip, and the drag-to-peek — so nothing is lost relative
to before. Giving the wheel itself a keyboard equivalent is open work.
