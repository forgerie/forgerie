---
id: 01M0EJEK86QNBZBP6H65E023ZP
slug: unify-session-tabs-workspace-tool-strip-and-control-sheet
title: Unify session tabs, workspace tool strip, and control sheet
origin: parked
status: To Do
priority: medium
labels:
  - shell
  - tabs
  - ux-debt
created: 2026-08-20
source: se-work
---

# Unify session tabs, workspace tool strip, and control sheet

## Why it matters

The session tab band is a third tab-like system beside the workspace panel's tool strip and the summoned control sheet. Named as accepted debt when the band shipped; leaving three selection systems long-term multiplies UI paths and confuses the promote/select vocabulary.

## Acceptance Criteria

- [ ] One selection model documents when a tool renders in the tool strip, the control sheet, or the session tab band
- [ ] No surface shows two tab systems at once
- [ ] Posture matrix captures reviewed after the consolidation

## Related

- `src/client/src/components/appShell/AppSessionTabs.ts`
- `src/client/src/components/WorkspacePanel.ts`
