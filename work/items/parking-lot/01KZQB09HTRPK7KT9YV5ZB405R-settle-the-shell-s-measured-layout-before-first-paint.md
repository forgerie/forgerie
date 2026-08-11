---
id: 01KZQB09HTRPK7KT9YV5ZB405R
slug: settle-the-shell-s-measured-layout-before-first-paint
title: "Settle the shell's measured layout before first paint"
origin: parked
status: To Do
priority: medium
labels:
  - client
  - layout
  - first-paint
created: 2026-08-11
source: se-work
---

# Settle the shell's measured layout before first paint

## Why it matters

AppShellController measures the shell box in hostUpdated, so the first render uses window.innerWidth as a guess and the corrected layout mode only reaches the DOM on the following update. On a narrow surface the shell therefore paints `docked-navigation` for one frame before switching to `overlay-navigation`. It was invisible while only one class depended on the measurement; now that disclosure and docking both drive shell classes and panel-edge attributes, the flash covers the whole grid. Verified in a happy-dom test: after one `updateComplete` the controller reports `overlay` while the rendered shell still carries `docked-navigation`.

## Acceptance Criteria

- [ ] A single awaited render settles the shell: the rendered class matches AppShellController.layoutMode and .disclosure after the first updateComplete
- [ ] PiWebApp.chromeDisclosure.test.ts no longer needs the settledApp double-await helper
- [ ] No visible layout flip on load at 499, 739, 789, and 979 CSS px

## Related

- `src/client/src/appShell/appShellController.ts`
- `src/client/src/components/PiWebApp.chromeDisclosure.test.ts`
- `prototypes/panel-peek/README.md`
