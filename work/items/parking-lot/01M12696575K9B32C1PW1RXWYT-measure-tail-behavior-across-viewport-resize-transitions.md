---
id: 01M12696575K9B32C1PW1RXWYT
slug: measure-tail-behavior-across-viewport-resize-transitions
title: Measure tail behavior across viewport resize transitions
origin: parked
status: To Do
priority: medium
labels:
  - chat
  - scroll
  - mobile
created: 2026-08-27
source: se-code-review
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: main
  repo: forgerie
  invoked_by: se-work
---

# Measure tail behavior across viewport resize transitions

## Why it matters

The scroll reset deliberately removes resize correction. Fold, rotation, and keyboard transitions can briefly move the viewport away from the tail until the next content update. Measure this on the acceptance device before deciding whether a small resize rule is needed.

## Acceptance Criteria

- [ ] Record tail and reader-owned behavior across all four Fold postures and keyboard open/close
- [ ] Decide whether native browser behavior is sufficient
- [ ] If not sufficient, define one resize rule that does not restore the removed scroll state machine

## Related

- `src/client/src/components/ChatView.ts`
- `src/client/src/chatScrollCoordinator.ts`
- `src/client/src/components/ChatView.scroll.test.ts`
