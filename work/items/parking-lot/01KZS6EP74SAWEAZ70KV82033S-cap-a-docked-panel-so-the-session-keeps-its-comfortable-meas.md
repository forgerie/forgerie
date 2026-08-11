---
id: 01KZS6EP74SAWEAZ70KV82033S
slug: cap-a-docked-panel-so-the-session-keeps-its-comfortable-meas
title: Cap a docked panel so the session keeps its comfortable measure
origin: parked
status: To Do
priority: low
labels:
  - client
  - layout
  - intrinsic-design
created: 2026-08-11
source: se-work
---

# Cap a docked panel so the session keeps its comfortable measure

## Why it matters

The seating fit decides with content minimums (session 560 + workspace 360 = 920) but the stylesheet sizes the workspace column at `minmax(360px, 42vw)`. At 979px the panel takes 411px and leaves the session 556px — four pixels under the comfortable measure the fit used to justify docking it. At the 920px floor it is worse: 42vw gives 386px and the session gets 533px. The model and the layout disagree about how the space is divided, so a panel the model called affordable can squeeze the transcript it was checked against. Visible today only as a few pixels, but it grows as the fit is trusted for more panels.

## Acceptance Criteria

- [ ] A docked panel never reduces the session below SESSION_COMFORTABLE_WIDTH
- [ ] The workspace column's preferred size is capped against the shell's own measured width, not the viewport
- [ ] Measured at 920, 979 and 1440: the session's rendered width is at or above 560

## Related

- `src/client/src/components/shared.ts`
- `src/client/src/appShell/panelIntent.ts`
- `src/client/src/appShell/shellLayoutMode.ts`
