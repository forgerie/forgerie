---
id: 01KZKS6M89CS8JKQSN32JHXG1D
slug: retire-viewport-width-breakpoints-and-the-fold-posture-cliff
title: Retire viewport width breakpoints and the Fold posture cliff
origin: parked
status: To Do
priority: medium
labels:
  - ux
  - intrinsic-design
  - mobile
  - tech-debt
created: 2026-08-09
source: user
context:
  branch: main
  repo: forgerie
  invoked_by: design session — mobile chat chrome
---

# Retire viewport width breakpoints and the Fold posture cliff

## Why it matters

AGENTS.md documents a known defect inherited at the fork point: a ~768px viewport-width breakpoint splits the Fold 8 posture matrix, so 739px (unfolded portrait) renders the phone layout while 789px (folded landscape) renders the desktop layout. Rotating the unfolded device swaps the entire UI paradigm. The mobile chrome work adds a content-derived vertical rule alongside these breakpoints rather than replacing them, so the cliff survives. Every additional feature built on top of the width breakpoints raises the cost of removing them later.

## Acceptance Criteria

- [ ] No @media width query governs which layout paradigm the shell renders
- [ ] Layout decisions are container-derived or computed from content needs, mirroring the shellLayoutMode.ts pattern
- [ ] All four Fold 8 postures render the same paradigm family, with no swap on rotation
- [ ] Scroll position, draft text, and open panels survive fold, unfold, and rotation

## Related

- `src/client/src/components/shared.ts`
- `src/client/src/appShell/shellLayoutMode.ts`
- `AGENTS.md`
- `prototypes/mobile-chrome/README.md`

## Notes

Deferred deliberately during the mobile chrome design session. User decision: add the vertical intrinsic rule alongside the existing breakpoints, leave the cliff for later.
