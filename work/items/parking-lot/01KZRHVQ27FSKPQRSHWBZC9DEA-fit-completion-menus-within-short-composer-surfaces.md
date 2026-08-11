---
id: 01KZRHVQ27FSKPQRSHWBZC9DEA
slug: fit-completion-menus-within-short-composer-surfaces
title: Fit completion menus within short composer surfaces
origin: parked
status: To Do
priority: low
labels:
  - frontend
  - responsive
  - autocomplete
created: 2026-08-11
source: se-debug
context:
  cwd: .
  branch: main
  commit: dac7781
  repo: forgerie
  invoked_by: se-debug
---

# Fit completion menus within short composer surfaces

## Why it matters

The restored menu is usable at 711 × 374 CSS pixels, but its top edge extends 11 pixels beyond the Fold 8 landscape viewport. The first command remains readable. A shorter surface or an open software keyboard could hide more of the first item.

## Acceptance Criteria

- [ ] Show the full popup border and first completion item at the 711 × 374 Fold 8 landscape viewport.
- [ ] Keep the completion list scrollable and preserve access to all returned items.
- [ ] Use container or measured available space. Do not add a viewport-width breakpoint.

## Related

- `src/client/src/components/AutocompleteMenu.ts`
- `src/client/src/components/shared.ts`

## Notes

Found during four-posture visual verification of the restored slash-command popup. The measured menu rectangle was y=-11, height=262 at 711 × 374.
