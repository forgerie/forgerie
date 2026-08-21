---
id: 01M0EWCC3JPP7QM7N0NSGDE8YC
slug: explain-why-archive-is-unavailable-on-pinned-session-rows
title: Explain why Archive is unavailable on pinned session rows
origin: parked
status: To Do
priority: low
labels:
  - ux
  - sessions
created: 2026-08-20
source: user
---

# Explain why Archive is unavailable on pinned session rows

## Why it matters

A pinned session silently loses every Archive affordance: the row action swaps to Unpin, the row menu drops the Archive item, and the palette action greys out with no reason. A real user hit this ("i cant archive this for some reason") and needed a support round-trip to learn the pin was the cause. A disabled Archive item with an "Unpin to archive" hint, or a toast on attempt, would make the invariant self-explaining.

## Acceptance Criteria

- [ ] A pinned session row still surfaces Archive in the row menu, disabled, with a visible 'Unpin to archive' reason (or equivalent affordance)
- [ ] The command palette's disabled 'Archive Session' communicates the pin as the reason when the selected session is pinned
- [ ] Tests cover the pinned-row menu affordance

## Related

- `src/client/src/components/SessionInboxPanel.ts`
- `src/client/src/sessionPersistence.ts`
- `src/client/src/plugins/core/actions.ts`
