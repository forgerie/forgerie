---
id: 01M00YJM1T7626CTKXBNY8PDNY
slug: revisit-floor-direction-tile-based-fleet-supervision
title: Revisit Floor direction (tile-based fleet supervision)
origin: parked
status: To Do
priority: low
labels:
  - design
  - prototype
  - frozen
created: 2026-08-14
source: user
---

# Revisit Floor direction (tile-based fleet supervision)

## Why it matters

Direction C proposed sessions as tiles in lanes ordered by what the work needs from the user. The premise is sound for supervising many agents at once, but tiles want to be boxes, which conflicts with the documented content-first decision in prototypes/mobile-chrome/README.md (resident chrome to zero, hierarchy from space not borders). Frozen rather than deleted because the fleet-supervision thesis may still be the right answer for wide surfaces like the Tab Ultra 11, where boxless density is less necessary.

## Acceptance Criteria

- [ ] A decision is recorded on whether tile containers are permitted at wide widths
- [ ] If revived, c-floor.html is rebuilt against the boxless rule or the rule is explicitly scoped to narrow panes

## Related

- `prototypes/direction/c-floor.html`
- `prototypes/direction/README.md`
- `prototypes/mobile-chrome/README.md`

## Notes

Frozen at user request. Do not delete c-floor.html. If revisited, first resolve the conflict with the boxless rule: either the fleet view earns boxes at wide widths, or it collapses into a dense list (which is Direction A).
