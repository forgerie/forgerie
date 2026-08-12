---
id: 01KZQ0EMT0H9DXGM1RGABXSXXB
slug: recover-active-turn-starts-after-daemon-restarts
title: Recover active turn starts after daemon restarts
origin: parked
status: To Do
priority: medium
labels:
  - sessions
  - runtime
  - recovery
created: 2026-08-10
source: user
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: main
  commit: d4189c4
  repo: forgerie
---

# Recover active turn starts after daemon restarts

## Why it matters

SessionActivity.activeSince is server-owned but currently held only in the session daemon's in-memory activity map. A daemon restart during an attached active turn would establish a new baseline rather than recover the turn's actual user-message start.

## Acceptance Criteria

- [ ] When an already-running session is attached after daemon startup, activeSince is reconstructed from durable session data.
- [ ] Browser refreshes and daemon restarts both preserve the same current-turn start.
- [ ] Tests cover restart recovery, queued follow-ups, and tool-transition activity.

## Related

- `src/server/sessions/piSessionService.ts`
- `src/shared/apiTypes.ts`

## Notes

Raised after the new browser loaded before the updated session daemon; the visible fallback reset to <1m on browser refresh.
