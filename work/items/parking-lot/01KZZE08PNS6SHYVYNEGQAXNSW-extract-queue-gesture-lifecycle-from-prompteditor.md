---
id: 01KZZE08PNS6SHYVYNEGQAXNSW
slug: extract-queue-gesture-lifecycle-from-prompteditor
title: Extract Queue gesture lifecycle from PromptEditor
origin: parked
status: To Do
priority: low
labels:
  - maintainability
  - composer
created: 2026-08-14
source: se-code-review
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie/.worktrees/fix/composer-working-controls
  branch: fix/composer-working-controls
  commit: 42d0011
  repo: forgerie
  invoked_by: se-work
---

# Extract Queue gesture lifecycle from PromptEditor

## Why it matters

The reviewed Queue and Steer interaction adds substantial timer and event state to an already large component. A focused controller could reduce future lifecycle risk after behavior stabilizes.

## Acceptance Criteria

- [ ] Move Queue pointer, keyboard, timer, capture, and click-suppression state behind one focused boundary.
- [ ] Keep PromptEditor responsible for rendering and Queue/Steer callbacks.
- [ ] Preserve all existing public interaction tests without behavior changes.

## Related

- `src/client/src/components/PromptEditor.ts`
- `src/client/src/composerQueuePress.ts`
- `src/client/src/components/PromptEditor.rail.test.ts`
