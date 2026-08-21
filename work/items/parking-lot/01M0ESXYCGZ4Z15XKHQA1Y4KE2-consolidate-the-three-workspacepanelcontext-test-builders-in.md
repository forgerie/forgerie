---
id: 01M0ESXYCGZ4Z15XKHQA1Y4KE2
slug: consolidate-the-three-workspacepanelcontext-test-builders-in
title: Consolidate the three WorkspacePanelContext test builders into shared testSupport
origin: parked
status: To Do
priority: medium
labels:
  - testing
  - client
created: 2026-08-20
source: se-work
---

# Consolidate the three WorkspacePanelContext test builders into shared testSupport

## Why it matters

panels.test.ts, WorkspaceFilesPanel.test.ts, and WorkspacePreviewPanel.test.ts each carry a near-identical ~40-line workspacePanelContext builder. The WorkspaceFilesPanel builder already silently dropped a new optional context field once (onOpenDocumentPreview during the preview work), producing a confusing false test failure. Every new context field now needs three edits, and the next silent drop will cost another debugging round.

## Acceptance Criteria

- [ ] One workspacePanelContext builder lives in a shared testSupport module under src/client/src
- [ ] The three existing test files consume it with per-test patches
- [ ] Adding a new optional WorkspacePanelContext field requires editing only the shared builder

## Related

- `src/client/src/plugins/core/panels.test.ts`
- `src/client/src/components/WorkspaceFilesPanel.test.ts`
- `src/client/src/components/WorkspacePreviewPanel.test.ts`
