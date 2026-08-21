---
id: 01M0ESYH41AJJ1ZNBY14DP5W6V
slug: clear-or-re-home-previewdocument-when-the-selected-workspace
title: Clear or re-home previewDocument when the selected workspace changes
origin: parked
status: To Do
priority: medium
labels:
  - client
  - ux
created: 2026-08-20
source: se-work
---

# Clear or re-home previewDocument when the selected workspace changes

## Why it matters

previewDocument survives switching workspaces, so the preview frame rebuilds its URL against the new workspace and renders the route's raw JSON error body for a path that does not exist there. Not destructive, but an undesigned state a user can reach in two clicks. The fix needs a decision: clear on switch, scope the document per workspace, or render a designed missing-document state from the route's 400.

## Acceptance Criteria

- [ ] Switching workspaces while a preview is open never shows a raw JSON error inside the frame
- [ ] The chosen behavior is covered by a test at the state or component layer

## Related

- `src/client/src/components/WorkspacePreviewPanel.ts`
- `src/client/src/appState.ts`
