---
id: 01M0EJEK893661YHEXYE2W2V98
slug: remove-the-unreachable-rendercontextbar-path-in-piwebapp
title: Remove the unreachable renderContextBar path in PiWebApp
origin: parked
status: To Do
priority: medium
labels:
  - shell
  - dead-code
created: 2026-08-20
source: se-work
---

# Remove the unreachable renderContextBar path in PiWebApp

## Why it matters

renderContextBar returns null unless the shell is both chrome-resident and mobile-overlay, and overlay widths are strictly below the resident threshold, so the branch can never render. Dead chrome code found while retiring the orphaned mobile main-tab strip; it misleads readers about what the shell shows.

## Acceptance Criteria

- [ ] renderContextBar and its AppContextBar usage are removed or given a reachable condition
- [ ] npm run verify passes including knip

## Related

- `src/client/src/components/PiWebApp.ts`
- `src/client/src/components/appShell/AppContextBar.ts`
