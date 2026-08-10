---
id: 01KZN1RQ4J9P0DK4TQ3CDFHE30
title: Collapse delegated forks in the session inbox
status: active
created: 2026-08-10
source: se-work
labels: [inbox, sessions, forks, delegation]
---

# Collapse delegated forks in the session inbox

The inbox shows 99 sibling rows titled "Investigate bug causal chain before
implementing a tested fix". They are fork-context children created by
`pi-subagents`, and they arrive at roughly 65 rows a day at current usage.

Origin: this item was split out of
`work/items/active/01KZMSMT9AH8A352RP58BY4H9C-delegated-agents-panel/`, whose
plan explicitly excluded inbox changes (`R9`). That exclusion was the error —
the agreed wireframe at `/tmp/forgerie-delegation-wireframe.png` shows a
suppressed inbox in Panel A, and the plan quietly converted a conclusion about
meaning into a decision to ship nothing.

## Progress

- [x] U1 detach manual forks at creation
- [x] U2 carry parent linkage into board input
- [x] U3 collapse children under a present parent
- [x] U4 collapse orphans under a placeholder
- [x] U5 unread and posture validation
