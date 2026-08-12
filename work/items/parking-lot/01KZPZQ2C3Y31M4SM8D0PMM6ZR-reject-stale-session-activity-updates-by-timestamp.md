---
id: 01KZPZQ2C3Y31M4SM8D0PMM6ZR
slug: reject-stale-session-activity-updates-by-timestamp
title: Reject stale session activity updates by timestamp
origin: parked
status: To Do
priority: medium
labels:
  - sessions
  - reconnect
  - ordering
created: 2026-08-10
source: se-code-review
context:
  cwd: /home/simonwjackson/code/sandbox/forgerie
  branch: feat/working-runtime
  repo: forgerie
---

# Reject stale session activity updates by timestamp

## Why it matters

SessionInboxController currently applies activity events by arrival order. A delayed event can overwrite a newer snapshot or event and rewind activeSince, labels, and phase-derived inbox state.

## Acceptance Criteria

- [ ] The inbox projection ignores an activity update older than the current activity for the same session.
- [ ] Reconnect snapshot and buffered-event ordering has deterministic tests.
- [ ] Equal timestamps have a documented tie rule.

## Related

- `src/client/src/controllers/sessionInboxController.ts`
